# Generate placeholder Tauri icons (PNG + ICO) from .NET System.Drawing.
# Writes to ..\src-tauri\icons\
#
# Replace later with `npx tauri icon <source.png>` once we have a real logo.

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$path = Join-Path $PSScriptRoot '..\src-tauri\icons'
$path = (Resolve-Path $path).Path
New-Item -ItemType Directory -Force -Path $path | Out-Null

function New-Png {
    param([int]$size, [string]$file)
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::FromArgb(15, 17, 21))

    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(59, 130, 246))
    $fontSize = [Math]::Max(6, [int]($size * 0.48))
    $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $g.DrawString('OS', $font, $brush, $rect, $format)

    $out = Join-Path $path $file
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "  wrote $file ($size x $size)"
}

Write-Host "Writing PNGs to $path"
New-Png -size 32 -file '32x32.png'
New-Png -size 128 -file '128x128.png'
New-Png -size 256 -file '128x128@2x.png'
New-Png -size 512 -file 'icon.png'

# ICO: use System.Drawing.Icon to convert a bitmap's handle.
# Note: this uses the 32x32 source; Windows will upscale as needed.
Write-Host 'Writing icon.ico'
$srcPath = Join-Path $path '32x32.png'
$bmp = [System.Drawing.Image]::FromFile($srcPath)
$hIcon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$fs = [System.IO.File]::Create((Join-Path $path 'icon.ico'))
$icon.Save($fs)
$fs.Close()
$bmp.Dispose()

Write-Host ''
Write-Host 'Done. Files:'
Get-ChildItem $path | Select-Object Name, Length | Format-Table -AutoSize
