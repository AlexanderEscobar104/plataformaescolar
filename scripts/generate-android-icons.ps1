$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectRoot "assets\icon.png"
$androidRes = Join-Path $projectRoot "android\app\src\main\res"

if (!(Test-Path $sourcePath)) {
  throw "No se encontro el icono base en $sourcePath"
}

$densities = @(
  @{ name = "ldpi"; size = 36 },
  @{ name = "mdpi"; size = 48 },
  @{ name = "hdpi"; size = 72 },
  @{ name = "xhdpi"; size = 96 },
  @{ name = "xxhdpi"; size = 144 },
  @{ name = "xxxhdpi"; size = 192 }
)

$backgroundColor = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
$transparent = [System.Drawing.Color]::FromArgb(0, 0, 0, 0)

function Test-NearWhite([System.Drawing.Color]$color) {
  return $color.R -ge 245 -and $color.G -ge 245 -and $color.B -ge 245
}

function New-TransparentLogoBitmap {
  param([string]$Path)

  $src = [System.Drawing.Bitmap]::new($Path)
  try {
    $w = $src.Width
    $h = $src.Height
    $mask = New-Object 'bool[,]' $w, $h
    $queue = [System.Collections.Generic.Queue[System.Drawing.Point]]::new()

    for ($x = 0; $x -lt $w; $x++) {
      foreach ($y in @(0, ($h - 1))) {
        if (-not $mask[$x, $y] -and (Test-NearWhite $src.GetPixel($x, $y))) {
          $mask[$x, $y] = $true
          $queue.Enqueue([System.Drawing.Point]::new($x, $y))
        }
      }
    }

    for ($y = 0; $y -lt $h; $y++) {
      foreach ($x in @(0, ($w - 1))) {
        if (-not $mask[$x, $y] -and (Test-NearWhite $src.GetPixel($x, $y))) {
          $mask[$x, $y] = $true
          $queue.Enqueue([System.Drawing.Point]::new($x, $y))
        }
      }
    }

    while ($queue.Count -gt 0) {
      $point = $queue.Dequeue()
      foreach ($delta in @(@(1, 0), @(-1, 0), @(0, 1), @(0, -1))) {
        $nx = $point.X + $delta[0]
        $ny = $point.Y + $delta[1]
        if ($nx -lt 0 -or $ny -lt 0 -or $nx -ge $w -or $ny -ge $h) {
          continue
        }
        if ($mask[$nx, $ny]) {
          continue
        }
        if (Test-NearWhite $src.GetPixel($nx, $ny)) {
          $mask[$nx, $ny] = $true
          $queue.Enqueue([System.Drawing.Point]::new($nx, $ny))
        }
      }
    }

    $trimmed = [System.Drawing.Bitmap]::new($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $minX = $w
    $minY = $h
    $maxX = -1
    $maxY = -1

    for ($y = 0; $y -lt $h; $y++) {
      for ($x = 0; $x -lt $w; $x++) {
        if ($mask[$x, $y]) {
          $trimmed.SetPixel($x, $y, $transparent)
          continue
        }

        $pixel = $src.GetPixel($x, $y)
        $trimmed.SetPixel($x, $y, $pixel)

        if ($pixel.A -gt 0) {
          if ($x -lt $minX) { $minX = $x }
          if ($y -lt $minY) { $minY = $y }
          if ($x -gt $maxX) { $maxX = $x }
          if ($y -gt $maxY) { $maxY = $y }
        }
      }
    }

    if ($maxX -lt 0 -or $maxY -lt 0) {
      throw "No se pudo detectar contenido visible en el icono."
    }

    $cropRect = [System.Drawing.Rectangle]::FromLTRB($minX, $minY, $maxX + 1, $maxY + 1)
    return $trimmed.Clone($cropRect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  } finally {
    $src.Dispose()
    if ($trimmed) { $trimmed.Dispose() }
  }
}

function New-SquareCanvasBitmap {
  param(
    [System.Drawing.Bitmap]$Logo,
    [int]$Size,
    [double]$Scale,
    [System.Nullable[System.Drawing.Color]]$Background
  )

  $canvas = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)

  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    if ($Background.HasValue) {
      $graphics.Clear($Background.Value)
    } else {
      $graphics.Clear($transparent)
    }

    $maxDim = [Math]::Max($Logo.Width, $Logo.Height)
    $target = [Math]::Round($Size * $Scale)
    $drawWidth = [int][Math]::Round($Logo.Width * $target / $maxDim)
    $drawHeight = [int][Math]::Round($Logo.Height * $target / $maxDim)
    $offsetX = [int][Math]::Round(($Size - $drawWidth) / 2)
    $offsetY = [int][Math]::Round(($Size - $drawHeight) / 2)

    $graphics.DrawImage($Logo, $offsetX, $offsetY, $drawWidth, $drawHeight)
    return $canvas
  } finally {
    $graphics.Dispose()
  }
}

$logo = New-TransparentLogoBitmap -Path $sourcePath

try {
  foreach ($density in $densities) {
    $dir = Join-Path $androidRes ("mipmap-" + $density.name)
    $size = $density.size

    $legacy = New-SquareCanvasBitmap -Logo $logo -Size $size -Scale 0.82 -Background $backgroundColor
    $foreground = New-SquareCanvasBitmap -Logo $logo -Size $size -Scale 1.0 -Background $backgroundColor
    $background = New-SquareCanvasBitmap -Logo $logo -Size $size -Scale 1.0 -Background $backgroundColor

    try {
      $legacy.Save((Join-Path $dir "ic_launcher.png"), [System.Drawing.Imaging.ImageFormat]::Png)
      $legacy.Save((Join-Path $dir "ic_launcher_round.png"), [System.Drawing.Imaging.ImageFormat]::Png)
      $foreground.Save((Join-Path $dir "ic_launcher_foreground.png"), [System.Drawing.Imaging.ImageFormat]::Png)
      $background.Save((Join-Path $dir "ic_launcher_background.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $legacy.Dispose()
      $foreground.Dispose()
      $background.Dispose()
    }
  }
} finally {
  $logo.Dispose()
}

Write-Output "Iconos Android regenerados correctamente."




