#!/usr/bin/env python3
"""
VidGlyph 桌面全套应用图标自动化生成脚本
- 从 public/logo.svg 渲染并生成 macOS ICNS、Windows ICO 及各尺寸 PNG 图标。
"""

import os
import subprocess
from PIL import Image

def generate_icons():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    svg_path = os.path.join(root_dir, 'public', 'logo.svg')
    tmp_png = '/tmp/vidglyph_1024.png'
    icons_dir = os.path.join(root_dir, 'src-tauri', 'icons')
    os.makedirs(icons_dir, exist_ok=True)

    print('[VidGlyph] 正在从 SVG 栅格化 1024x1024 高保真 PNG...')
    subprocess.run(['rsvg-convert', '-w', '1024', '-h', '1024', svg_path, '-o', tmp_png], check=True)

    img_master = Image.open(tmp_png)

    # 1. 基础尺寸
    print('[VidGlyph] 生成标准 PNG 图标尺寸...')
    img_master.resize((32, 32), Image.Resampling.LANCZOS).save(os.path.join(icons_dir, '32x32.png'))
    img_master.resize((128, 128), Image.Resampling.LANCZOS).save(os.path.join(icons_dir, '128x128.png'))
    img_master.resize((256, 256), Image.Resampling.LANCZOS).save(os.path.join(icons_dir, '128x128@2x.png'))
    img_master.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(icons_dir, '512x512.png'))
    img_master.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(root_dir, 'public', 'icon.png'))

    # 2. Windows 多尺寸 ICO
    print('[VidGlyph] 生成 Windows 多尺寸 icon.ico...')
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img_master.save(os.path.join(icons_dir, 'icon.ico'), sizes=ico_sizes)
    img_master.resize((32, 32), Image.Resampling.LANCZOS).save(os.path.join(root_dir, 'public', 'favicon.ico'), sizes=[(16, 16), (32, 32)])

    # 3. macOS iconutil 生成标准 .icns
    print('[VidGlyph] 生成 macOS 原生 icon.icns...')
    iconset_dir = '/tmp/VidGlyph.iconset'
    os.makedirs(iconset_dir, exist_ok=True)
    icns_specs = [
        ('icon_16x16.png', 16),
        ('icon_16x16@2x.png', 32),
        ('icon_32x32.png', 32),
        ('icon_32x32@2x.png', 64),
        ('icon_128x128.png', 128),
        ('icon_128x128@2x.png', 256),
        ('icon_256x256.png', 256),
        ('icon_256x256@2x.png', 512),
        ('icon_512x512.png', 512),
        ('icon_512x512@2x.png', 1024),
    ]
    for name, sz in icns_specs:
        img_master.resize((sz, sz), Image.Resampling.LANCZOS).save(os.path.join(iconset_dir, name))

    subprocess.run(['iconutil', '-c', 'icns', iconset_dir, '-o', os.path.join(icons_dir, 'icon.icns')], check=True)
    print('[VidGlyph] 全套图标生成成功！')

if __name__ == '__main__':
    generate_icons()
