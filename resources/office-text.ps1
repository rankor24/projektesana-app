# Text of an old Office file through the installed Office (COM): .doc/.rtf (Word), .xls (Excel), .msg (Outlook), .ppt (PowerPoint).
# Opens read-only, macros force-disabled, alerts off, never saves, quits the Office application it started.
# Output: one line of JSON on stdout: {"ok":true,"pages":["..."]} or {"ok":false,"reason":"..."}.
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File office-text.ps1 -Path <file> -Kind doc|xls|msg|ppt
param(
	[Parameter(Mandatory = $true)][string]$Path,
	[Parameter(Mandatory = $true)][string]$Kind
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Out-Result($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4)) }

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Out-Result @{ ok = $false; reason = "fails nav atrasts" }; exit 0 }
$full = (Resolve-Path -LiteralPath $Path).ProviderPath

$app = $null
try {
	switch ($Kind) {
		'doc' {
			$app = New-Object -ComObject Word.Application
			$app.Visible = $false
			$app.DisplayAlerts = 0
			$app.AutomationSecurity = 3
			# Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, PasswordDocument, ..)
			$doc = $app.Documents.Open($full, $false, $true, $false, 'x-no-password')
			$text = $doc.Content.Text -replace "`r", "`n" -replace "`a", "`t"
			$doc.Close(0)
			Out-Result @{ ok = $true; pages = @($text) }
		}
		'xls' {
			$app = New-Object -ComObject Excel.Application
			$app.Visible = $false
			$app.DisplayAlerts = $false
			$app.AutomationSecurity = 3
			# Open(FileName, UpdateLinks, ReadOnly, Format, Password)
			$wb = $app.Workbooks.Open($full, 0, $true, 5, 'x-no-password')
			$parts = @()
			foreach ($ws in $wb.Worksheets) {
				$lines = @("# " + $ws.Name)
				$used = $ws.UsedRange
				$rows = $used.Rows.Count
				$cols = $used.Columns.Count
				$vals = $used.Value2
				for ($r = 1; $r -le $rows; $r++) {
					$cells = @()
					for ($c = 1; $c -le $cols; $c++) {
						$v = if ($rows -eq 1 -and $cols -eq 1) { $vals } else { $vals[$r, $c] }
						$cells += [string]$v
					}
					$line = ($cells -join "`t").TrimEnd()
					if ($line) { $lines += $line }
				}
				$parts += ($lines -join "`n")
			}
			$wb.Close($false)
			Out-Result @{ ok = $true; pages = @($parts -join "`n`n") }
		}
		'msg' {
			$app = New-Object -ComObject Outlook.Application
			$item = $app.Session.OpenSharedItem($full)
			$head = "Temats: $($item.Subject)`nNo: $($item.SenderName)`nNosūtīts: $($item.SentOn)`nKam: $($item.To)"
			$att = @()
			foreach ($a in $item.Attachments) { $att += $a.FileName }
			if ($att.Count) { $head += "`nPielikumi: " + ($att -join ', ') }
			$body = $item.Body
			$item.Close(1)
			Out-Result @{ ok = $true; pages = @("$head`n`n$body") }
			$app = $null
		}
		'ppt' {
			$app = New-Object -ComObject PowerPoint.Application
			# Open(FileName, ReadOnly, Untitled, WithWindow)
			$pres = $app.Presentations.Open($full, -1, 0, 0)
			$pages = @()
			foreach ($s in $pres.Slides) {
				$t = @()
				foreach ($sh in $s.Shapes) { if ($sh.HasTextFrame -and $sh.TextFrame.HasText) { $t += $sh.TextFrame.TextRange.Text } }
				$pages += ($t -join "`n")
			}
			$pres.Close()
			Out-Result @{ ok = $true; pages = $pages }
		}
		default { Out-Result @{ ok = $false; reason = "nezināms veids: $Kind" } }
	}
} catch {
	Out-Result @{ ok = $false; reason = $_.Exception.Message }
} finally {
	# Outlook is left running: quitting it would close the user's own mailbox window
	if ($app -ne $null) { try { $app.Quit() } catch {} ; [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
	[GC]::Collect()
}
