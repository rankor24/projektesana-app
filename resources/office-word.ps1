# Edits a Word document and exports it to PDF through the installed Word (COM). Task 8.13.
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File office-word.ps1 -Mode apply -Path <docx> -Out <docx> -OpsFile <ops.json> [-DryRun]
#   powershell ... -File office-word.ps1 -Mode pdf -Path <docx> -Out <pdf>
# apply: all or nothing. The ops (validated in Node, src/sources/export/word-ops.ts) run in order on the open document; the first one that
#   matches nothing stops the run and nothing is saved. -Out different from -Path: the source is opened read-only and the result saved
#   as -Out. -Out equal to -Path: the file is edited in place (the caller has taken a copy first).
# Macros are force-disabled, alerts off. If Word was already running with documents open (the user's own), it is left running and its
# settings are not touched; only a Word this script started is quit.
# Output: one line of JSON on stdout: {"ok":true,...} or {"ok":false,"reason":"...","op":<n>}.
param(
	[Parameter(Mandatory = $true)][string]$Mode,
	[Parameter(Mandatory = $true)][string]$Path,
	[Parameter(Mandatory = $true)][string]$Out,
	[string]$OpsFile = '',
	[switch]$DryRun
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Out-Result($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6)) }
function Has($op, $name) { return ($null -ne $op.PSObject.Properties[$name]) }
function Cell-Text($cell) { return $cell.Range.Text.TrimEnd([char]13, [char]7) }
function To-Word([string]$s) { return ($s -replace "`r`n", "`n") -replace "`n", "`r" }
function Esc-Find([string]$s) { return $s.Replace('^', '^^') }
function Bgr([string]$hex) {
	$r = [Convert]::ToInt32($hex.Substring(0, 2), 16); $g = [Convert]::ToInt32($hex.Substring(2, 2), 16); $b = [Convert]::ToInt32($hex.Substring(4, 2), 16)
	return $r + 256 * $g + 65536 * $b
}
function Style-Range($rng, $op) {
	if (Has $op 'color') { $rng.Font.Color = (Bgr $op.color) }
	if (Has $op 'bold') { $rng.Font.Bold = $(if ($op.bold) { 1 } else { 0 }) }
	if (Has $op 'italic') { $rng.Font.Italic = $(if ($op.italic) { 1 } else { 0 }) }
}

# the start positions of the paragraphs that contain the anchor, last first (so editing one leaves the others' positions valid)
function Find-Paras($doc, [string]$anchor, $op) {
	$starts = New-Object System.Collections.Generic.List[int]
	$rng = $doc.Content
	$f = $rng.Find
	$f.ClearFormatting()
	$f.Text = (Esc-Find $anchor); $f.Forward = $true; $f.Wrap = 0; $f.MatchCase = $true; $f.MatchWildcards = $false; $f.Format = $false
	while ($f.Execute()) {
		$par = $rng.Paragraphs.Item(1).Range
		$starts.Add($par.Start)
		$rng.SetRange($par.End, $doc.Content.End)
		if ($par.End -ge $doc.Content.End) { break }
	}
	if ($starts.Count -eq 0) { throw "teksts «$anchor» nav atrasts" }
	if (Has $op 'all') { $pick = @($starts) }
	else {
		$n = [int]$op.occurrence
		if ($n -lt 1 -or $n -gt $starts.Count) { throw "«$anchor» atrasts $($starts.Count) rindkopās, $n. nav" }
		$pick = @($starts[$n - 1])
	}
	[array]::Reverse($pick)
	return , $pick
}

function Op-Replace($doc, $op) {
	$matched = 0; $limit = [int]$op.count
	$story = $doc.StoryRanges.Item(1)
	while ($null -ne $story) {
		$r = $story.Duplicate
		$f = $r.Find
		$f.ClearFormatting()
		$f.Text = (Esc-Find $op.find); $f.Forward = $true; $f.Wrap = 0; $f.MatchCase = [bool]$op.match_case; $f.MatchWildcards = $false; $f.Format = $false
		while ((($limit -eq 0) -or ($matched -lt $limit)) -and $f.Execute()) {
			$r.Text = (To-Word $op.replace)
			$matched++
			$r.SetRange($r.End, $r.StoryLength)
		}
		if (-not [bool]$op.headers) { break }
		if ($limit -ne 0 -and $matched -ge $limit) { break }
		$story = $story.NextStoryRange
	}
	if ($matched -eq 0) { throw "teksts «$($op.find)» nav atrasts" }
	return $matched
}

function Op-InsertAfter($doc, $op) {
	$lines = (To-Word $op.text) -split "`r"
	$n = 0
	foreach ($start in (Find-Paras $doc $op.anchor $op)) {
		$curStart = $start
		foreach ($line in $lines) {
			# split the paragraph at its end (as pressing Enter there): both marks keep this paragraph's formatting.
			# Positions, not paragraph objects: an object grows with the insertion and would then reach the next paragraph.
			$cur = $doc.Range($curStart, $curStart).Paragraphs.Item(1)
			$at = $cur.Range.End - 1
			$doc.Range($at, $at).InsertAfter("`r")
			$curStart = $at + 1
			$new = $doc.Range($curStart, $curStart).Paragraphs.Item(1)
			if (-not (Has $op 'keep_numbering')) { $new.Range.ListFormat.RemoveNumbers() }
			if ($line.Length -gt 0) { $new.Range.InsertBefore($line) }
			if (Has $op 'style') {
				try { $new.Style = $op.style } catch { throw "stils «$($op.style)» šajā dokumentā nav" }
			}
			Style-Range $new.Range $op
		}
		$n++
	}
	return $n
}

function Op-AppendText($doc, $op) {
	$n = 0
	foreach ($start in (Find-Paras $doc $op.anchor $op)) {
		$p = $doc.Range($start, $start).Paragraphs.Item(1)
		$at = $p.Range.End - 1
		$doc.Range($at, $at).InsertAfter($op.text)
		Style-Range ($doc.Range($at, $at + $op.text.Length)) $op
		$n++
	}
	return $n
}

function Row-Of($t, [string]$key, [bool]$exact) {
	foreach ($c in $t.Range.Cells) {
		$txt = Cell-Text $c
		if ($(if ($exact) { $txt.Trim() -eq $key.Trim() } else { $txt.Contains($key) })) { return $c.RowIndex }
	}
	return 0
}

# the first table (and its 1-based row) the op names
function Pick-Cell-Table($doc, $op, [bool]$needRow) {
	$count = $doc.Tables.Count
	if ($count -eq 0) { throw "dokumentā nav tabulu" }
	$cand = @()
	if (Has $op 'table') {
		$i = [int]$op.table
		if ($i -lt 0 -or $i -ge $count) { throw "tabulas $i nav (dokumentā ir $count)" }
		$cand = @($doc.Tables.Item($i + 1))
	}
	else {
		for ($i = 1; $i -le $count; $i++) {
			$t = $doc.Tables.Item($i)
			if (Has $op 'table_match') { if ($t.Range.Text.Contains($op.table_match)) { $cand += $t } }
			else { if ((Row-Of $t $op.row_match ([bool]$op.exact)) -gt 0) { $cand += $t } }
		}
	}
	if ($cand.Count -eq 0) { throw "tabula nav atrasta" }
	foreach ($t in $cand) {
		if (-not $needRow) { return @{ t = $t; row = 0 } }
		if (Has $op 'row') {
			$r = [int]$op.row + 1
			if ($r -lt 1 -or $r -gt $t.Rows.Count) { throw "rindas $($op.row) nav (tabulā ir $($t.Rows.Count))" }
			return @{ t = $t; row = $r }
		}
		$r = Row-Of $t $op.row_match ([bool]$op.exact)
		if ($r -gt 0) { return @{ t = $t; row = $r } }
	}
	throw "rinda «$($op.row_match)» nav atrasta"
}

function Op-SetCell($doc, $op) {
	$pick = Pick-Cell-Table $doc $op $true
	$t = $pick.t
	if (Has $op 'col') { $col = [int]$op.col + 1 }
	else {
		$col = 0
		$head = $t.Rows.Item(1).Cells
		for ($i = 1; $i -le $head.Count; $i++) { if ((Cell-Text $head.Item($i)).Contains($op.col_match)) { $col = $i; break } }
		if ($col -eq 0) { throw "kolonna «$($op.col_match)» nav atrasta pirmajā rindā" }
	}
	$cell = $t.Cell($pick.row, $col)
	$cell.Range.Text = (To-Word $op.text)
	if (Has $op 'color') { $cell.Range.Font.Color = (Bgr $op.color) }
	return 1
}

function Op-AddRow($doc, $op) {
	$pick = Pick-Cell-Table $doc $op $false
	$t = $pick.t
	$cols = $t.Rows.Item(1).Cells.Count
	if ($op.cells.Count -gt $cols) { throw "cells ir $($op.cells.Count) vērtības, tabulā ir $cols kolonnas" }
	$rows = $t.Rows.Count
	if ((Has $op 'after_row') -and ([int]$op.after_row + 1) -lt $rows) {
		if ([int]$op.after_row -lt 0) { throw "after_row nav derīgs" }
		$row = $t.Rows.Add($t.Rows.Item([int]$op.after_row + 2))
	}
	else {
		if ((Has $op 'after_row') -and [int]$op.after_row -ge $rows) { throw "rindas $($op.after_row) nav (tabulā ir $rows)" }
		$row = $t.Rows.Add()
	}
	for ($i = 0; $i -lt $op.cells.Count; $i++) { $row.Cells.Item($i + 1).Range.Text = (To-Word ([string]$op.cells[$i])) }
	return 1
}

function Op-DeleteRow($doc, $op) {
	$pick = Pick-Cell-Table $doc $op $true
	$pick.t.Rows.Item($pick.row).Delete()
	return 1
}

function Op-DeleteParagraph($doc, $op) {
	$n = 0
	foreach ($start in (Find-Paras $doc $op.anchor $op)) {
		$doc.Range($start, $start).Paragraphs.Item(1).Range.Delete() | Out-Null
		$n++
	}
	return $n
}

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Out-Result @{ ok = $false; reason = "fails nav atrasts" }; exit 0 }
$full = (Resolve-Path -LiteralPath $Path).ProviderPath
$outFull = [System.IO.Path]::GetFullPath($Out)

$app = $null; $doc = $null; $own = $false
try {
	$app = New-Object -ComObject Word.Application
	$own = ($app.Documents.Count -eq 0)
	if ($own) { $app.Visible = $false; $app.DisplayAlerts = 0; $app.AutomationSecurity = 3 }
	$inPlace = ($Mode -eq 'apply') -and ($full -ieq $outFull)
	$m = [Type]::Missing
	# Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, PasswordDocument, PasswordTemplate, Revert, WritePasswordDocument, WritePasswordTemplate, Format, Encoding, Visible)
	$doc = $app.Documents.Open($full, $false, (-not $inPlace), $false, 'x-no-password', $m, $m, $m, $m, $m, $m, $false)
	if ($Mode -eq 'pdf') {
		$doc.ExportAsFixedFormat($outFull, 17)
		Out-Result @{ ok = $true; saved = $true; out = $outFull }
	}
	elseif ($Mode -eq 'apply') {
		$ops = @((Get-Content -LiteralPath $OpsFile -Raw -Encoding UTF8 | ConvertFrom-Json))
		if ($ops.Count -eq 1 -and $ops[0] -is [array]) { $ops = $ops[0] }
		$done = @()
		$failed = $null
		for ($i = 0; $i -lt $ops.Count; $i++) {
			$op = $ops[$i]
			try {
				$n = switch ($op.op) {
					'replace' { Op-Replace $doc $op }
					'insert_after' { Op-InsertAfter $doc $op }
					'append_text' { Op-AppendText $doc $op }
					'set_cell' { Op-SetCell $doc $op }
					'add_row' { Op-AddRow $doc $op }
					'delete_row' { Op-DeleteRow $doc $op }
					'delete_paragraph' { Op-DeleteParagraph $doc $op }
					default { throw "nezināma darbība $($op.op)" }
				}
				$done += @{ op = $i + 1; kind = $op.op; matched = $n }
			}
			catch { $failed = @{ op = $i + 1; kind = $op.op; reason = $_.Exception.Message }; break }
		}
		if ($failed) { Out-Result @{ ok = $false; op = $failed.op; kind = $failed.kind; reason = $failed.reason; done = $done; saved = $false } }
		elseif ($DryRun) { Out-Result @{ ok = $true; saved = $false; done = $done } }
		else {
			if ($inPlace) { $doc.Save() } else { $doc.SaveAs2($outFull, 12) }
			Out-Result @{ ok = $true; saved = $true; out = $outFull; done = $done }
		}
	}
	else { Out-Result @{ ok = $false; reason = "nezināms režīms: $Mode" } }
}
catch {
	Out-Result @{ ok = $false; reason = $_.Exception.Message }
}
finally {
	if ($doc -ne $null) { try { $doc.Close(0) } catch {} }
	if ($app -ne $null) {
		# a Word the user already had open with documents is theirs: left running
		if ($own) { try { $app.Quit(0) } catch {} }
		[void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
	}
	[GC]::Collect()
}
