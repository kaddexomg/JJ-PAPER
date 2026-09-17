$sig = @"
[DllImport("kernel32.dll", SetLastError = true)]
public static extern IntPtr GetStdHandle(int nStdHandle);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);
"@
try {
    $t = Add-Type -MemberDefinition $sig -Name "Win32Console" -Namespace "JJ" -PassThru
    $h = $t[0]::GetStdHandle(-10)
    $m = 0
    if ($t[0]::GetConsoleMode($h, [ref]$m)) {
        $newM = ($m -band (-bnot 0x0040)) -bor 0x0080
        $ok = $t[0]::SetConsoleMode($h, $newM)
        Write-Host "Console QuickEdit disabled: $ok (Old: $m, New: $newM)"
    }
} catch {
    Write-Host "Error: $_"
}
