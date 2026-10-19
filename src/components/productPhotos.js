// Credits for the licensed example photos (data-product-photos.json, public/products/), which the
// About page shows in its material-to-product animation. They are no longer used as previews of
// generated ideas: a photo of *a* shelf is not a picture of the user's shelf, so idea and project
// cards show a picture generated from that exact idea instead (see ProductPreview.jsx).
import PHOTOS from '../data-product-photos.json';

export const PHOTO_CREDITS = Object.entries(PHOTOS).map(([key, p]) => ({ key, ...p }));
