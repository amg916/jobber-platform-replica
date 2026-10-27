"""Reproduce Round 5 artwork from the supplied reference screenshots."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
crops = {
    'quotes_deep_lawn': ('quotes', (205, 150, 620, 290)),
    'marketing_reviews_art': ('marketing', (330, 560, 630, 802)),
    'timesheets_banner_art': ('timesheets', (820, 144, 1495, 332)),
    'expenses_forwarding_art': ('expenses', (812, 224, 920, 288)),
    'onboarding_avatar': ('home', (1174, 770, 1208, 804)),
}
for name, (source, box) in crops.items():
    target = root / 'docs/round2_live_assets' / (name + '.jpg')
    with Image.open(root / 'screenshots/reference' / (source + '.jpg')) as image:
        image.crop(box).convert('RGB').save(target, quality=98, subsampling=0)
    print(f'{target.name}: {box[2]-box[0]} × {box[3]-box[1]}')
