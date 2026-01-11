#!/usr/bin/env python3
"""
Fix wheelchair sprite sheet:
1. Fix victory dance frames (16, 18) using frame 20
2. Scale down each frame to add bottom padding for alignment
"""
from PIL import Image, ImageOps

# Frame dimensions (21 frames, 49x51 each)
FRAME_WIDTH = 49
FRAME_HEIGHT = 51
NUM_FRAMES = 21


def get_frame(img, frame_num):
    """Extract a single frame from the sprite sheet."""
    x = frame_num * FRAME_WIDTH
    return img.crop((x, 0, x + FRAME_WIDTH, FRAME_HEIGHT))


def set_frame(img, frame_num, frame):
    """Paste a frame into the sprite sheet."""
    x = frame_num * FRAME_WIDTH
    img.paste(frame, (x, 0))


def fix_victory_dance(sprite_path, output_path):
    """Fix frames 16 and 18 using frame 20 (one flipped)."""
    img = Image.open(sprite_path).convert('RGBA')

    # Get frame 20 (the celebration pose)
    frame_20 = get_frame(img, 20)
    frame_20_flipped = ImageOps.mirror(frame_20)

    # Set frame 16 to frame 20
    set_frame(img, 16, frame_20)
    # Set frame 18 to frame 20 flipped horizontally
    set_frame(img, 18, frame_20_flipped)

    img.save(output_path)
    print(f"Fixed victory dance: frame 16 = frame 20, frame 18 = frame 20 flipped")
    return output_path


def scale_sprite_frames(sprite_path, output_path, scale=0.88, bottom_padding=6):
    """Scale down each frame individually and position with bottom padding."""
    img = Image.open(sprite_path).convert('RGBA')

    # Create a new transparent image at original size
    new_img = Image.new('RGBA', (img.width, img.height), (0, 0, 0, 0))

    for i in range(NUM_FRAMES):
        # Extract this frame
        frame = get_frame(img, i)

        # Scale down the frame
        new_w = int(FRAME_WIDTH * scale)
        new_h = int(FRAME_HEIGHT * scale)
        scaled_frame = frame.resize((new_w, new_h), Image.Resampling.LANCZOS)

        # Calculate position within the frame cell
        # Center horizontally, position with bottom padding
        x = i * FRAME_WIDTH
        x_offset = x + (FRAME_WIDTH - new_w) // 2
        y_offset = FRAME_HEIGHT - new_h - bottom_padding

        # Paste scaled frame
        new_img.paste(scaled_frame, (x_offset, y_offset))

    new_img.save(output_path)
    print(f"Scaled {NUM_FRAMES} frames to {scale*100:.0f}% with {bottom_padding}px bottom padding")


if __name__ == "__main__":
    sprite_path = "test/maze-game/assets/wheelchair.png"

    # Step 1: Fix victory dance frames
    fix_victory_dance(sprite_path, sprite_path)

    # Step 2: Scale for alignment
    scale_sprite_frames(sprite_path, sprite_path, scale=0.88, bottom_padding=6)
