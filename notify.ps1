# dsh-tu4-notification - WinForms toast notification for DSH approval requests.
#
# Design: dark card matching the DSH web dark theme (design-platform.css tokens),
# 4px brand-blue accent bar, auto-fade after $Seconds, no focus steal, no buttons.
#
# IMPORTANT: this file is intentionally pure ASCII. PowerShell 5.1 reads BOM-less
# .ps1 files as ANSI (GBK on zh-CN Windows), which would garble UTF-8 Chinese.
# All display text therefore arrives via -Title / -Body (UTF-16 command line).
#
# Usage:
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden `
#     -File notify.ps1 -Title <title> -Body <body> [-Seconds 10]
#
# Exit code: 0 = shown, 1 = failed (caller should fall back to msg.exe).

param(
    [string]$Title   = 'DSH',
    [string]$Body    = '',
    [int]$Seconds    = 10,
    [string]$PreviewOut = ''   # if set: render the card to a PNG and exit (visual self-check)
)

$ErrorActionPreference = 'Stop'
try {
    # --- Native interop: DPI awareness + show without stealing focus ---
    Add-Type -Namespace DshNotify -Name Win32 -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetDpiForSystem();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern int GetWindowLong(System.IntPtr hWnd, int nIndex);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern int SetWindowLong(System.IntPtr hWnd, int nIndex, int dwNewLong);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
'@

    [void][DshNotify.Win32]::SetProcessDPIAware()
    $dpi = [DshNotify.Win32]::GetDpiForSystem()
    if ($dpi -lt 96) { $dpi = 96 }
    $scale = [double]$dpi / 96.0

    # Scale a 96-dpi design value to physical pixels (crisp on HiDPI displays).
    function px([double]$v) { return [int][Math]::Round($v * $scale) }

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    # Font helper: PowerShell 5.1's New-Object cannot bind Font's multi-arg
    # constructors (string/float/enum), so build fonts through C# instead.
    # WinForms maps FontStyle.Bold -> the Segoe UI Semibold (600) face.
    Add-Type -Namespace DshNotify -Name Fonts -ReferencedAssemblies 'System.Drawing' -MemberDefinition @'
public static System.Drawing.Font Bold(string family, float size) {
    return new System.Drawing.Font(family, size, System.Drawing.FontStyle.Bold);
}
public static System.Drawing.Font Regular(string family, float size) {
    return new System.Drawing.Font(family, size);
}
'@

    # SVG path -> GDI+ GraphicsPath parser + rounded-rect helper.
    # Used to draw the DSH whale logo (official path from FishLogo.tsx) as
    # vector graphics: crisp at any DPI and no external image file needed.
    # Supports absolute/relative M L C Z, implicit command repetition and
    # scientific notation.
    Add-Type -Namespace DshNotify -Name SvgPath -ReferencedAssemblies 'System.Drawing' -MemberDefinition @'
public static System.Drawing.Drawing2D.GraphicsPath FromSvg(string d) {
    var gp = new System.Drawing.Drawing2D.GraphicsPath();
    char[] chars = d.ToCharArray();
    int i = 0;
    char lastCmd = '\0';
    double cx = 0, cy = 0, sx = 0, sy = 0;
    while (i < chars.Length) {
        char c = chars[i];
        if (c == ' ' || c == ',' || c == '\t' || c == '\r' || c == '\n') { i++; continue; }
        char cmd;
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) { cmd = c; i++; lastCmd = cmd; }
        else if (lastCmd != '\0') { cmd = lastCmd; }
        else { i++; continue; }
        bool rel = (cmd >= 'a' && cmd <= 'z');
        char up = (char)(cmd & ~0x20);
        if (up == 'Z') { gp.CloseFigure(); cx = sx; cy = sy; continue; }
        int need;
        if (up == 'M' || up == 'L') need = 2;
        else if (up == 'C') need = 6;
        else { i++; continue; }
        var vals = new double[need];
        int got = 0;
        while (got < need && i < chars.Length) {
            while (i < chars.Length && (chars[i] == ' ' || chars[i] == ',' || chars[i] == '\t' || chars[i] == '\r' || chars[i] == '\n')) i++;
            if (i >= chars.Length) break;
            if ((chars[i] >= 'A' && chars[i] <= 'Z') || (chars[i] >= 'a' && chars[i] <= 'z')) break;
            int start = i;
            if (chars[i] == '+' || chars[i] == '-') i++;
            bool hasDot = false;
            while (i < chars.Length) {
                char ch = chars[i];
                if (ch >= '0' && ch <= '9') i++;
                else if (ch == '.' && !hasDot) { hasDot = true; i++; }
                else if ((ch == 'e' || ch == 'E') && i > start) {
                    i++;
                    if (i < chars.Length && (chars[i] == '+' || chars[i] == '-')) i++;
                    while (i < chars.Length && chars[i] >= '0' && chars[i] <= '9') i++;
                    break;
                }
                else break;
            }
            if (i == start) i++;
            vals[got++] = double.Parse(d.Substring(start, i - start), System.Globalization.CultureInfo.InvariantCulture);
        }
        if (got < need) break;
        if (up == 'M') {
            double x = vals[0] + (rel ? cx : 0), y = vals[1] + (rel ? cy : 0);
            gp.StartFigure();
            cx = x; cy = y; sx = x; sy = y;
            lastCmd = rel ? 'l' : 'L'; // implicit repetition of M means L
        }
        else if (up == 'L') {
            double x = vals[0] + (rel ? cx : 0), y = vals[1] + (rel ? cy : 0);
            gp.AddLine((float)cx, (float)cy, (float)x, (float)y);
            cx = x; cy = y;
        }
        else if (up == 'C') {
            double x1 = vals[0] + (rel ? cx : 0), y1 = vals[1] + (rel ? cy : 0);
            double x2 = vals[2] + (rel ? cx : 0), y2 = vals[3] + (rel ? cy : 0);
            double x = vals[4] + (rel ? cx : 0), y = vals[5] + (rel ? cy : 0);
            gp.AddBezier((float)cx, (float)cy, (float)x1, (float)y1, (float)x2, (float)y2, (float)x, (float)y);
            cx = x; cy = y;
        }
    }
    return gp;
}
public static System.Drawing.Drawing2D.GraphicsPath RoundedRect(float x, float y, float w, float h, float r) {
    var gp = new System.Drawing.Drawing2D.GraphicsPath();
    if (r <= 0) { gp.AddRectangle(new System.Drawing.RectangleF(x, y, w, h)); return gp; }
    float d = r * 2;
    gp.AddArc(x, y, d, d, 180, 90);
    gp.AddArc(x + w - d, y, d, d, 270, 90);
    gp.AddArc(x + w - d, y + h - d, d, d, 0, 90);
    gp.AddArc(x, y + h - d, d, d, 90, 90);
    gp.CloseFigure();
    return gp;
}
'@

    # Official DSH whale logo path (extracted from
    # packages/client/ui-primitives/src/FishLogo.tsx, viewBox 23.16x17.04).
    # Pure ASCII; embedded verbatim.
    $WHALE_PATH = @'
M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z
'@
    $WHALE_PATH = $WHALE_PATH.Trim()

    # --- DSH dark theme tokens (packages/client/ui-theme/src/styles/design-platform.css) ---
    $bgColor     = [System.Drawing.Color]::FromArgb(21, 21, 23)      # #151517 neutral-bluish-950
    $borderColor = [System.Drawing.Color]::FromArgb(42, 42, 46)     # #2A2A2E ~ border-l1
    $accentColor = [System.Drawing.Color]::FromArgb(103, 158, 254)  # #679EFE deepseek-400 (brand)
    $titleColor  = [System.Drawing.Color]::FromArgb(249, 250, 251)  # #F9FAFB label-primary (dark)
    $bodyColor   = [System.Drawing.Color]::FromArgb(207, 211, 214)  # #CFD3D6 label-secondary (dark)
    $iconBgColor = [System.Drawing.Color]::FromArgb(249, 250, 251)  # #F9FAFB icon plate (near-white, shows black whale)
    $whaleColor  = [System.Drawing.Color]::FromArgb(0, 0, 0)        # #000000 official DSH black whale (Harness logo)

    # --- Truncate text to fit a max-width x max-height box, appending "..." ---
    function FitText([string]$text, [System.Drawing.Font]$font, [int]$maxW, [int]$maxH) {
        if ([string]::IsNullOrWhiteSpace($text)) { return '' }
        $bmp = New-Object System.Drawing.Bitmap($maxW, [Math]::Max(1, $maxH))
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $rect = New-Object System.Drawing.SizeF($maxW, 10000)
            if ($g.MeasureString($text, $font, $rect).Height -le $maxH) { return $text }
            # Binary search for the longest prefix that fits, then append "...".
            $lo = 1; $hi = $text.Length; $best = ''
            while ($lo -le $hi) {
                $mid = [int](($lo + $hi) / 2)
                $candidate = $text.Substring(0, $mid) + '...'
                if ($g.MeasureString($candidate, $font, $rect).Height -le $maxH) {
                    $best = $candidate
                    $lo = $mid + 1
                } else {
                    $hi = $mid - 1
                }
            }
            if ($best -ne '') { return $best }
            return '...'
        } finally {
            $g.Dispose()
            $bmp.Dispose()
        }
    }

    # --- Layout (96-dpi design units) ---
    $w        = px 428
    $h        = px 96
    $barW     = px 4
    $margin   = px 48
    $iconSize = px 55
    $iconX    = px 14
    $iconY    = [int](($h - $iconSize) / 2)
    $textX    = $iconX + $iconSize + (px 12)
    $bodyW    = $w - $textX - (px 14)
    $bodyH    = px 44

    $form = New-Object System.Windows.Forms.Form
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $form.StartPosition   = [System.Windows.Forms.FormStartPosition]::Manual
    $form.ShowInTaskbar   = $false
    $form.TopMost         = $true
    $form.BackColor       = $bgColor
    $form.ClientSize      = New-Object System.Drawing.Size($w, $h)
    $form.Opacity         = 1.0

    # 1px border (FormBorderStyle.None draws none).
    $form.Add_Paint({
        param($sender, $e)
        $pen = New-Object System.Drawing.Pen($borderColor, 1)
        try {
            $e.Graphics.DrawRectangle($pen, 0, 0, $sender.ClientSize.Width - 1, $sender.ClientSize.Height - 1)
        } finally { $pen.Dispose() }
    })

    # Left accent bar (brand blue).
    $bar = New-Object System.Windows.Forms.Panel
    $bar.BackColor = $accentColor
    $bar.Location  = New-Object System.Drawing.Point(0, 0)
    $bar.Size      = New-Object System.Drawing.Size($barW, $h)
    $form.Controls.Add($bar)

    # Whale logo icon (vector): rounded plate + brand-blue whale, left-aligned.
    $whalePath = [DshNotify.SvgPath]::FromSvg($WHALE_PATH)
    $wb = $whalePath.GetBounds()
    $iconPad = px 5
    $scaleF  = ($iconSize - 2 * $iconPad) / $wb.Width
    $drawnH  = $wb.Height * $scaleF
    $offY    = ($iconSize - $drawnH) / 2
    $whaleMatrix = New-Object System.Drawing.Drawing2D.Matrix(
        [float]$scaleF, [float]0, [float]0, [float]$scaleF,
        [float]$iconPad, [float]$offY)
    $whalePath.Transform($whaleMatrix)

    $iconPanel = New-Object System.Windows.Forms.Panel
    $iconPanel.Location = New-Object System.Drawing.Point($iconX, $iconY)
    $iconPanel.Size     = New-Object System.Drawing.Size($iconSize, $iconSize)
    $iconPanel.BackColor = $bgColor
    $iconPanel.Add_Paint({
        param($sender, $e)
        $g = $e.Graphics
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $plate = [DshNotify.SvgPath]::RoundedRect(0, 0, $iconSize, $iconSize, (px 8))
        $brush = New-Object System.Drawing.SolidBrush($iconBgColor)
        try { $g.FillPath($brush, $plate) } finally { $brush.Dispose() }
        $wbrush = New-Object System.Drawing.SolidBrush($whaleColor)
        try { $g.FillPath($wbrush, $whalePath) } finally { $wbrush.Dispose() }
    })
    $form.Controls.Add($iconPanel)

    # Title label.
    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.AutoSize  = $true
    $titleLabel.Font      = [DshNotify.Fonts]::Bold('Segoe UI', [float]11)
    $titleLabel.ForeColor = $titleColor
    $titleLabel.BackColor = $bgColor
    $titleLabel.Location  = New-Object System.Drawing.Point($textX, (px 12))
    $titleLabel.Text      = $Title
    $form.Controls.Add($titleLabel)

    # Body label (wraps to at most 2 lines, ellipsis-truncated).
    $bodyFont = [DshNotify.Fonts]::Regular('Segoe UI', [float]9.5)
    $bodyLabel = New-Object System.Windows.Forms.Label
    $bodyLabel.AutoSize     = $false
    $bodyLabel.AutoEllipsis = $true
    $bodyLabel.Font         = $bodyFont
    $bodyLabel.ForeColor    = $bodyColor
    $bodyLabel.BackColor    = $bgColor
    $bodyLabel.Location     = New-Object System.Drawing.Point($textX, (px 40))
    $bodyLabel.Size         = New-Object System.Drawing.Size($bodyW, $bodyH)
    $bodyLabel.Text         = FitText $Body $bodyFont $bodyW $bodyH
    $form.Controls.Add($bodyLabel)

    # Position: bottom-right corner of the primary work area.
    $work = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $form.Location = New-Object System.Drawing.Point(
        ($work.Right - $w - $margin),
        ($work.Bottom - $h - $margin))

    # Show without stealing focus (belt and braces):
    # 1) WS_EX_NOACTIVATE before the window is shown;
    # 2) remember the foreground window and restore it if activation slipped through.
    $GWL_EXSTYLE      = -20
    $WS_EX_NOACTIVATE = 0x08000000
    $exStyle = [DshNotify.Win32]::GetWindowLong($form.Handle, $GWL_EXSTYLE)
    [void][DshNotify.Win32]::SetWindowLong($form.Handle, $GWL_EXSTYLE, ($exStyle -bor $WS_EX_NOACTIVATE))

    $prevForeground = [DshNotify.Win32]::GetForegroundWindow()
    $form.Add_Shown({
        if ($prevForeground -ne [System.IntPtr]::Zero) {
            $now = [DshNotify.Win32]::GetForegroundWindow()
            if ($now -ne $prevForeground) {
                [void][DshNotify.Win32]::SetForegroundWindow($prevForeground)
            }
        }
    })

    # Show, then play the notification sound.
    $form.Show()

    # Preview mode: render the card to a PNG and exit (visual self-check,
    # no sound, no auto-dismiss timer).
    if ($PreviewOut) {
        $bmp = New-Object System.Drawing.Bitmap($w, $h)
        try {
            $form.DrawToBitmap($bmp, (New-Object System.Drawing.Rectangle(0, 0, $w, $h)))
            $bmp.Save($PreviewOut, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $bmp.Dispose()
            $form.Close()
        }
        exit 0
    }

    [System.Media.SystemSounds]::Exclamation.Play()

    # Optional debug dump (set DSH_NOTIFY_DEBUG=1): window state after Show().
    if ($env:DSH_NOTIFY_DEBUG) {
        try {
            $dbg = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'dsh-tu4-notification-debug.txt')
            $ex2 = [DshNotify.Win32]::GetWindowLong($form.Handle, $GWL_EXSTYLE)
            $pb = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
            Set-Content -Path $dbg -Value @(
                "time=$([DateTime]::Now.ToString('o'))",
                "clientSize=$($form.ClientSize) size=$($form.Size) location=$($form.Location)",
                "visible=$($form.Visible) topmost=$($form.TopMost) opacity=$($form.Opacity)",
                "exStyle=0x{0:X8}" -f [uint32]$ex2,
                "workArea=($($work.X),$($work.Y) $($work.Width)x$($work.Height))",
                "primaryBounds=($($pb.X),$($pb.Y) $($pb.Width)x$($pb.Height))"
            )
        } catch {}
    }

    # Auto-dismiss: fade out during the last 800 ms, then close.
    $totalMs = [Math]::Max(3000, $Seconds * 1000)
    $fadeMs  = 800
    $start   = [DateTime]::Now
    $timer   = New-Object System.Windows.Forms.Timer
    $timer.Interval = 50
    $timer.Add_Tick({
        $elapsed = ([DateTime]::Now - $start).TotalMilliseconds
        if ($elapsed -ge $totalMs) {
            $timer.Stop()
            $form.Close()
        }
        elseif ($elapsed -ge ($totalMs - $fadeMs)) {
            $form.Opacity = [Math]::Max(0.0, ($totalMs - $elapsed) / $fadeMs)
        }
    })
    $timer.Start()

    [System.Windows.Forms.Application]::Run($form)
    $timer.Stop()
    exit 0
}
catch {
    Write-Error "[dsh-tu4-notification] notify.ps1 failed: $($_.Exception.Message)"
    exit 1
}
