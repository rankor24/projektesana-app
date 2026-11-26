# The screen helper of the Revit popup handling (src/revit/screen.ts starts it, one call per action; never an agent's shell).
# It only ever looks at and acts on windows of Revit.exe processes: the list of Revit's modal popups, a picture of a screen area, one mouse click, one Escape key,
# one button press by name. Whether an action is allowed is decided by the app (src/revit/dialog-policy.ts) before it calls this; the checks here are the second lock
# (the target window must belong to a Revit process and must be a popup of it).
#
#   revit-screen.ps1 -Op windows
#   revit-screen.ps1 -Op shot   -Left L -Top T -Width W -Height H        (PNG, base64, on stdout)
#   revit-screen.ps1 -Op click  -X x -Y y [-Double] -Hwnd h              (h = the popup the point is in)
#   revit-screen.ps1 -Op key    -Key Escape -Hwnd h
#   revit-screen.ps1 -Op press  -Name "OK" -Hwnd h                       (UI Automation Invoke of the button with that name)
#   revit-screen.ps1 -Op cursor
param(
	[Parameter(Mandatory = $true)][ValidateSet('windows', 'shot', 'click', 'key', 'press', 'cursor')][string]$Op,
	[int]$Left = 0, [int]$Top = 0, [int]$Width = 0, [int]$Height = 0,
	[int]$X = 0, [int]$Y = 0, [switch]$Double, [long]$Hwnd = 0,
	[string]$Key = '', [string]$Name = '',
	# the program whose popups are handled: always Revit; another name only for a manual test of this script (the app never passes it)
	[string]$Process = 'Revit'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class RevitScreenNative {
	public delegate bool EnumProc(IntPtr h, IntPtr l);
	[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
	[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
	[DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
	[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
	[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
	[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
	[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
	[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
	[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
	[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
	[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, UIntPtr e);
	[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
	[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
	[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
	public static List<IntPtr> TopLevel() {
		var l = new List<IntPtr>();
		EnumWindows((h, p) => { l.Add(h); return true; }, IntPtr.Zero);
		return l;
	}
}
'@
[void][RevitScreenNative]::SetProcessDPIAware()

function Win-Pid([IntPtr]$h) { $p = [uint32]0; [void][RevitScreenNative]::GetWindowThreadProcessId($h, [ref]$p); return [int]$p }
function Win-Text([IntPtr]$h) { $b = New-Object System.Text.StringBuilder 512; [void][RevitScreenNative]::GetWindowText($h, $b, 512); return $b.ToString() }
function Win-Class([IntPtr]$h) { $b = New-Object System.Text.StringBuilder 256; [void][RevitScreenNative]::GetClassName($h, $b, 256); return $b.ToString() }
function Win-Rect([IntPtr]$h) { $r = New-Object RevitScreenNative+RECT; [void][RevitScreenNative]::GetWindowRect($h, [ref]$r); return @{ left = $r.Left; top = $r.Top; right = $r.Right; bottom = $r.Bottom } }
function Revit-Pids { return @(Get-Process -Name $Process -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) }
function Rect-Of($el) { try { $b = $el.Current.BoundingRectangle; if ($b.IsEmpty) { return $null }; return @{ left = [int]$b.Left; top = [int]$b.Top; right = [int]$b.Right; bottom = [int]$b.Bottom } } catch { return $null } }

# The popups of every Revit process: a top-level window of that process that is enabled and visible while the process's main window is disabled
# (that is what "modal" is: the owner is switched off while the popup is up).
function Get-Popups {
	$pids = Revit-Pids
	$out = @()
	foreach ($rp in $pids) {
		$mainHwnd = [IntPtr]::Zero
		try { $mainHwnd = (Get-Process -Id $rp).MainWindowHandle } catch { }
		$wins = @()
		foreach ($h in [RevitScreenNative]::TopLevel()) {
			if ((Win-Pid $h) -ne $rp) { continue }
			if (-not [RevitScreenNative]::IsWindowVisible($h)) { continue }
			$wins += $h
		}
		$mainEnabled = $true
		if ($mainHwnd -ne [IntPtr]::Zero) { $mainEnabled = [RevitScreenNative]::IsWindowEnabled($mainHwnd) }
		if ($mainEnabled) { continue }
		foreach ($h in $wins) {
			if ($h -eq $mainHwnd) { continue }
			if (-not [RevitScreenNative]::IsWindowEnabled($h)) { continue }
			$title = Win-Text $h
			$rect = Win-Rect $h
			if (($rect.right - $rect.left) -lt 120 -or ($rect.bottom - $rect.top) -lt 60) { continue }
			$texts = @(); $buttons = @(); $boxes = @(); $edits = 0
			try {
				$root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
				$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
				foreach ($el in $all) {
					$t = $el.Current.ControlType
					$n = $el.Current.Name
					if ($t -eq [System.Windows.Automation.ControlType]::Button) {
						if ($n) { $buttons += @{ name = $n; id = $el.Current.AutomationId; rect = (Rect-Of $el) } }
					} elseif ($t -eq [System.Windows.Automation.ControlType]::CheckBox -or $t -eq [System.Windows.Automation.ControlType]::RadioButton) {
						if ($n) { $boxes += $n }
					} elseif ($t -eq [System.Windows.Automation.ControlType]::Edit -or $t -eq [System.Windows.Automation.ControlType]::ComboBox) {
						$edits++
					} elseif ($t -eq [System.Windows.Automation.ControlType]::Text -or $t -eq [System.Windows.Automation.ControlType]::Hyperlink) {
						if ($n) { $texts += $n }
					}
				}
			} catch { }
			$out += @{ hwnd = [long]$h; pid = $rp; title = $title; className = (Win-Class $h); rect = $rect; text = ($texts -join "`n"); buttons = $buttons; checkboxes = $boxes; edits = $edits }
		}
	}
	return $out
}

function Assert-Popup([long]$h) {
	if ($h -eq 0) { throw 'no window given' }
	$ptr = [IntPtr]$h
	if ((Revit-Pids) -notcontains (Win-Pid $ptr)) { throw 'the window does not belong to Revit' }
	$found = $false
	foreach ($p in (Get-Popups)) { if ($p.hwnd -eq $h) { $found = $true } }
	if (-not $found) { throw 'the window is not a popup of Revit (any more)' }
	return $ptr
}

switch ($Op) {
	'windows' {
		$list = Get-Popups
		@{ ok = $true; popups = $list } | ConvertTo-Json -Depth 8 -Compress
	}
	'cursor' {
		$p = New-Object RevitScreenNative+POINT; [void][RevitScreenNative]::GetCursorPos([ref]$p)
		@{ ok = $true; x = $p.X; y = $p.Y } | ConvertTo-Json -Compress
	}
	'shot' {
		if ($Width -lt 1 -or $Height -lt 1) { throw 'empty area' }
		$bmp = New-Object System.Drawing.Bitmap $Width, $Height
		$g = [System.Drawing.Graphics]::FromImage($bmp)
		$g.CopyFromScreen($Left, $Top, 0, 0, (New-Object System.Drawing.Size $Width, $Height))
		$g.Dispose()
		$ms = New-Object System.IO.MemoryStream
		$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
		$bmp.Dispose()
		@{ ok = $true; width = $Width; height = $Height; png = [Convert]::ToBase64String($ms.ToArray()) } | ConvertTo-Json -Compress
	}
	'click' {
		$ptr = Assert-Popup $Hwnd
		[void][RevitScreenNative]::SetForegroundWindow($ptr)
		Start-Sleep -Milliseconds 120
		[void][RevitScreenNative]::SetCursorPos($X, $Y)
		Start-Sleep -Milliseconds 80
		$n = 1; if ($Double) { $n = 2 }
		for ($i = 0; $i -lt $n; $i++) {
			[RevitScreenNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
			[RevitScreenNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
			Start-Sleep -Milliseconds 60
		}
		@{ ok = $true; x = $X; y = $Y } | ConvertTo-Json -Compress
	}
	'key' {
		$ptr = Assert-Popup $Hwnd
		if ($Key -ne 'Escape') { throw 'only the Escape key is allowed' }
		[void][RevitScreenNative]::SetForegroundWindow($ptr)
		Start-Sleep -Milliseconds 120
		[RevitScreenNative]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero)
		[RevitScreenNative]::keybd_event(0x1B, 0, 0x0002, [UIntPtr]::Zero)
		@{ ok = $true; key = 'Escape' } | ConvertTo-Json -Compress
	}
	'press' {
		$ptr = Assert-Popup $Hwnd
		$root = [System.Windows.Automation.AutomationElement]::FromHandle($ptr)
		$cond = New-Object System.Windows.Automation.AndCondition((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)), (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Name)))
		$btn = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
		if ($null -eq $btn) { throw "no button named '$Name'" }
		$pat = $null
		if ($btn.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pat)) { $pat.Invoke(); @{ ok = $true; how = 'invoke' } | ConvertTo-Json -Compress }
		else { throw 'the button cannot be invoked' }
	}
}
