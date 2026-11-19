/**
 * Library of ready-made image assets for the Images palette tab.
 *
 * Photo groups: Adobe Stock (free collection) photos licensed through the
 * project owner's Adobe account and background-removed; filenames embed the
 * Stock asset ID (<group>-as<ID>.png). Badges: official vendor marketing
 * badges from each store's badge program. Mascots, 3D objects, stickers,
 * products, cards, drawings and line art: illustrations drawn for this
 * project's templates, which also use them, so a template and the palette
 * share one file. Three cards build on library photos, and every sketch is a
 * pencil or painted version of one (see the license record). Full license
 * record: docs/image-asset-licenses.md.
 *
 * Each item becomes an image element with imageSrc pointing at the asset;
 * defaultSize preserves the asset's aspect ratio.
 */

export interface LibraryImageDef {
  id: string;
  label: string;
  src: string;
  defaultSize: { width: number; height: number };
}

export interface ImageCategory {
  id: string;
  label: string;
  items: LibraryImageDef[];
}

export const IMAGE_CATEGORIES: ImageCategory[] = [
  {
    id: 'touch',
    label: 'Touch',
    items: [
      { id: 'touch-as451105828', label: 'Holding phone', src: '/elements/images/touch/touch-as451105828.png', defaultSize: { width: 430, height: 426 } },
      { id: 'touch-as453449839', label: 'Pointing up', src: '/elements/images/touch/touch-as453449839.png', defaultSize: { width: 124, height: 430 } },
      { id: 'touch-as298911650', label: 'Number one', src: '/elements/images/touch/touch-as298911650.png', defaultSize: { width: 230, height: 430 } },
      { id: 'touch-as238910264', label: 'Index raised', src: '/elements/images/touch/touch-as238910264.png', defaultSize: { width: 366, height: 430 } },
      { id: 'touch-as623733433', label: 'Touch · POV', src: '/elements/images/touch/touch-as623733433.png', defaultSize: { width: 215, height: 430 } },
      { id: 'touch-as499928144', label: 'Touch reach', src: '/elements/images/touch/touch-as499928144.png', defaultSize: { width: 166, height: 430 } },
      { id: 'touch-as727752847', label: 'Soft touch', src: '/elements/images/touch/touch-as727752847.png', defaultSize: { width: 291, height: 430 } },
      { id: 'touch-as110599965', label: 'Diagonal point', src: '/elements/images/touch/touch-as110599965.png', defaultSize: { width: 430, height: 362 } },
      { id: 'touch-as141798361', label: 'Reaching point', src: '/elements/images/touch/touch-as141798361.png', defaultSize: { width: 430, height: 430 } },
      { id: 'touch-as276631249', label: 'Tap gesture', src: '/elements/images/touch/touch-as276631249.png', defaultSize: { width: 430, height: 402 } },
      { id: 'touch-as129534859', label: 'Point · suit sleeve', src: '/elements/images/touch/touch-as129534859.png', defaultSize: { width: 430, height: 254 } },
      { id: 'touch-as323025868', label: 'Side point up', src: '/elements/images/touch/touch-as323025868.png', defaultSize: { width: 430, height: 304 } },
      { id: 'touch-as346581973', label: 'Elegant point', src: '/elements/images/touch/touch-as346581973.png', defaultSize: { width: 430, height: 214 } },
      { id: 'touch-as292288154', label: 'Side point', src: '/elements/images/touch/touch-as292288154.png', defaultSize: { width: 430, height: 147 } },
      { id: 'touch-as327495361', label: 'Side point · deep tone', src: '/elements/images/touch/touch-as327495361.png', defaultSize: { width: 430, height: 158 } },
      { id: 'touch-as703311334', label: 'Touch point', src: '/elements/images/touch/touch-as703311334.png', defaultSize: { width: 430, height: 196 } },
    ],
  },
  {
    id: 'badges',
    label: 'Badges',
    items: [
      { id: 'app-store', label: 'App Store', src: '/elements/images/badges/app-store.svg', defaultSize: { width: 419, height: 140 } },
      { id: 'google-play', label: 'Google Play', src: '/elements/images/badges/google-play.png', defaultSize: { width: 362, height: 140 } },
      { id: 'microsoft-store', label: 'Microsoft Store', src: '/elements/images/badges/microsoft-store.svg', defaultSize: { width: 512, height: 140 } },
      { id: 'amazon-appstore', label: 'Amazon Appstore', src: '/elements/images/badges/amazon-appstore.png', defaultSize: { width: 477, height: 140 } },
      { id: 'f-droid', label: 'F-Droid', src: '/elements/images/badges/f-droid.png', defaultSize: { width: 362, height: 140 } },
    ],
  },
  {
    id: 'girls',
    label: 'Girls',
    items: [
      { id: 'girls-as479330034', label: 'Browsing phone', src: '/elements/images/girls/girls-as479330034.png', defaultSize: { width: 337, height: 430 } },
      { id: 'girls-as568002174', label: 'Texting · sitting', src: '/elements/images/girls/girls-as568002174.png', defaultSize: { width: 310, height: 430 } },
      { id: 'girls-as568605361', label: 'Smiling with phone', src: '/elements/images/girls/girls-as568605361.png', defaultSize: { width: 258, height: 430 } },
      { id: 'girls-as608612382', label: 'Checking phone', src: '/elements/images/girls/girls-as608612382.png', defaultSize: { width: 232, height: 430 } },
      { id: 'girls-as616151886', label: 'Video call wave', src: '/elements/images/girls/girls-as616151886.png', defaultSize: { width: 300, height: 430 } },
      { id: 'girls-as622285813', label: 'Thinking · phone', src: '/elements/images/girls/girls-as622285813.png', defaultSize: { width: 257, height: 430 } },
    ],
  },
  {
    id: 'guys',
    label: 'Guys',
    items: [
      { id: 'guys-as176708273', label: 'Chatting on phone', src: '/elements/images/guys/guys-as176708273.png', defaultSize: { width: 322, height: 430 } },
      { id: 'guys-as211660510', label: 'Walking with phone', src: '/elements/images/guys/guys-as211660510.png', defaultSize: { width: 233, height: 430 } },
      { id: 'guys-as299117684', label: 'Phone call', src: '/elements/images/guys/guys-as299117684.png', defaultSize: { width: 297, height: 430 } },
      { id: 'guys-as476183094', label: 'Reading phone', src: '/elements/images/guys/guys-as476183094.png', defaultSize: { width: 314, height: 430 } },
      { id: 'guys-as488088494', label: 'Using phone', src: '/elements/images/guys/guys-as488088494.png', defaultSize: { width: 261, height: 430 } },
      { id: 'guys-as625425247', label: 'Thumbs up · phone', src: '/elements/images/guys/guys-as625425247.png', defaultSize: { width: 430, height: 379 } },
    ],
  },
  {
    id: 'couples',
    label: 'Couples',
    items: [
      { id: 'couples-as227869490', label: 'Couple thumbs up', src: '/elements/images/couples/couples-as227869490.png', defaultSize: { width: 359, height: 430 } },
      { id: 'couples-as262780760', label: 'Couple with phones', src: '/elements/images/couples/couples-as262780760.png', defaultSize: { width: 407, height: 430 } },
      { id: 'couples-as298905292', label: 'Sharing phones', src: '/elements/images/couples/couples-as298905292.png', defaultSize: { width: 430, height: 364 } },
      { id: 'couples-as307920555', label: 'Showing message', src: '/elements/images/couples/couples-as307920555.png', defaultSize: { width: 405, height: 430 } },
      { id: 'couples-as368194171', label: 'Looking together', src: '/elements/images/couples/couples-as368194171.png', defaultSize: { width: 430, height: 279 } },
      { id: 'couples-as470959149', label: 'Couple with phone', src: '/elements/images/couples/couples-as470959149.png', defaultSize: { width: 384, height: 430 } },
    ],
  },
  {
    id: 'group',
    label: 'Group',
    items: [
      { id: 'group-as214592142', label: 'Friends group', src: '/elements/images/group/group-as214592142.png', defaultSize: { width: 430, height: 261 } },
      { id: 'group-as244073395', label: 'Friends with phones', src: '/elements/images/group/group-as244073395.png', defaultSize: { width: 430, height: 362 } },
      { id: 'group-as295798026', label: 'Girl friends', src: '/elements/images/group/group-as295798026.png', defaultSize: { width: 430, height: 291 } },
      { id: 'group-as398965262', label: 'Casual group', src: '/elements/images/group/group-as398965262.png', defaultSize: { width: 430, height: 287 } },
      { id: 'group-as471810871', label: 'Pointing at you', src: '/elements/images/group/group-as471810871.png', defaultSize: { width: 430, height: 227 } },
      { id: 'group-as483315298', label: 'Millennial friends', src: '/elements/images/group/group-as483315298.png', defaultSize: { width: 430, height: 246 } },
    ],
  },
  {
    id: 'family',
    label: 'Family',
    items: [
      { id: 'family-as127321511', label: 'Family of four', src: '/elements/images/family/family-as127321511.png', defaultSize: { width: 430, height: 304 } },
      { id: 'family-as234847100', label: 'Family standing', src: '/elements/images/family/family-as234847100.png', defaultSize: { width: 231, height: 430 } },
      { id: 'family-as296936711', label: 'Family with child', src: '/elements/images/family/family-as296936711.png', defaultSize: { width: 370, height: 430 } },
      { id: 'family-as334540672', label: 'Family on floor', src: '/elements/images/family/family-as334540672.png', defaultSize: { width: 430, height: 287 } },
      { id: 'family-as512401061', label: 'Indian family', src: '/elements/images/family/family-as512401061.png', defaultSize: { width: 430, height: 350 } },
      { id: 'family-as722428418', label: 'Family of three', src: '/elements/images/family/family-as722428418.png', defaultSize: { width: 362, height: 430 } },
    ],
  },
  {
    id: 'education',
    label: 'Education',
    items: [
      { id: 'education-as268560315', label: 'Student with backpack', src: '/elements/images/education/education-as268560315.png', defaultSize: { width: 244, height: 430 } },
      { id: 'education-as298618010', label: 'Student texting', src: '/elements/images/education/education-as298618010.png', defaultSize: { width: 273, height: 430 } },
      { id: 'education-as405130341', label: 'Student with earphones', src: '/elements/images/education/education-as405130341.png', defaultSize: { width: 240, height: 430 } },
      { id: 'education-as436829852', label: 'School kid', src: '/elements/images/education/education-as436829852.png', defaultSize: { width: 256, height: 430 } },
      { id: 'education-as436941892', label: 'Student with laptop', src: '/elements/images/education/education-as436941892.png', defaultSize: { width: 219, height: 430 } },
    ],
  },
  {
    id: 'food-drink',
    label: 'Food & drink',
    items: [
      { id: 'food-drink-as208918895', label: 'Floating burger', src: '/elements/images/food-drink/food-drink-as208918895.png', defaultSize: { width: 218, height: 430 } },
      { id: 'food-drink-as303510494', label: 'Flying burger', src: '/elements/images/food-drink/food-drink-as303510494.png', defaultSize: { width: 292, height: 430 } },
      { id: 'food-drink-as335665739', label: 'Burger & fries', src: '/elements/images/food-drink/food-drink-as335665739.png', defaultSize: { width: 430, height: 158 } },
      { id: 'food-drink-as348511870', label: 'Flying sandwich', src: '/elements/images/food-drink/food-drink-as348511870.png', defaultSize: { width: 166, height: 430 } },
      { id: 'food-drink-as376289112', label: 'Tasty burger', src: '/elements/images/food-drink/food-drink-as376289112.png', defaultSize: { width: 430, height: 280 } },
      { id: 'food-drink-as565185576', label: 'Chicken burger', src: '/elements/images/food-drink/food-drink-as565185576.png', defaultSize: { width: 430, height: 267 } },
    ],
  },
  {
    id: 'mascots',
    label: 'Mascots',
    items: [
      { id: 'mascot-bunny', label: 'Bunny', src: '/elements/images/mascots/mascot-bunny.png', defaultSize: { width: 345, height: 430 } },
      { id: 'mascot-bunny-hourglass', label: 'Bunny with hourglass', src: '/elements/images/mascots/mascot-bunny-hourglass.png', defaultSize: { width: 370, height: 430 } },
      { id: 'mascot-bunny-medal', label: 'Bunny with medal', src: '/elements/images/mascots/mascot-bunny-medal.png', defaultSize: { width: 312, height: 430 } },
      { id: 'mascot-bunny-party', label: 'Party bunny', src: '/elements/images/mascots/mascot-bunny-party.png', defaultSize: { width: 380, height: 430 } },
      { id: 'mascot-paper', label: 'Paper buddy', src: '/elements/images/mascots/mascot-paper.png', defaultSize: { width: 384, height: 430 } },
      { id: 'mascot-robot', label: 'Robot', src: '/elements/images/mascots/mascot-robot.png', defaultSize: { width: 430, height: 385 } },
      { id: 'mascot-sun', label: 'Sun', src: '/data/projects/sunup-mascot-happy.png', defaultSize: { width: 430, height: 430 } },
      { id: 'mascot-sun-wink', label: 'Winking sun', src: '/data/projects/sunup-mascot-wink.png', defaultSize: { width: 430, height: 430 } },
      { id: 'mascot-signer-ily', label: 'Signer, I love you sign', src: '/elements/images/mascots/mascot-signer-ily.png', defaultSize: { width: 304, height: 430 } },
      { id: 'mascot-signer-point', label: 'Signer pointing', src: '/elements/images/mascots/mascot-signer-point.png', defaultSize: { width: 382, height: 430 } },
      { id: 'mascot-signer-clipboard', label: 'Signer with clipboard', src: '/elements/images/mascots/mascot-signer-clipboard.png', defaultSize: { width: 275, height: 430 } },
      { id: 'mascot-signer-chest', label: 'Signer, hand on chest', src: '/elements/images/mascots/mascot-signer-chest.png', defaultSize: { width: 222, height: 430 } },
    ],
  },
  {
    id: 'objects',
    label: '3D objects',
    items: [
      { id: 'object-coin', label: 'Gold coin', src: '/elements/images/objects/object-coin.png', defaultSize: { width: 426, height: 430 } },
      { id: 'object-coins-small', label: 'Coin stack', src: '/elements/images/objects/object-coins-small.png', defaultSize: { width: 430, height: 257 } },
      { id: 'object-coins-medium', label: 'Coin pile', src: '/elements/images/objects/object-coins-medium.png', defaultSize: { width: 430, height: 286 } },
      { id: 'object-coins-large', label: 'Coin heap', src: '/elements/images/objects/object-coins-large.png', defaultSize: { width: 430, height: 315 } },
      { id: 'object-chest', label: 'Treasure chest', src: '/elements/images/objects/object-chest.png', defaultSize: { width: 430, height: 421 } },
      { id: 'object-padlock', label: 'Padlock', src: '/elements/images/objects/object-padlock.png', defaultSize: { width: 327, height: 430 } },
      { id: 'object-bolt', label: 'Lightning bolt', src: '/elements/images/objects/object-bolt.png', defaultSize: { width: 293, height: 430 } },
      { id: 'object-paper-plane', label: 'Paper plane', src: '/elements/images/objects/object-paper-plane.png', defaultSize: { width: 381, height: 430 } },
      { id: 'object-dollar', label: 'Dollar sign', src: '/elements/images/objects/object-dollar.png', defaultSize: { width: 283, height: 430 } },
      { id: 'object-globe', label: 'Globe', src: '/elements/images/objects/object-globe.png', defaultSize: { width: 430, height: 421 } },
      { id: 'object-wifi', label: 'Wifi', src: '/elements/images/objects/object-wifi.png', defaultSize: { width: 430, height: 266 } },
      { id: 'object-toy-plane', label: 'Toy plane', src: '/elements/images/objects/object-toy-plane.png', defaultSize: { width: 430, height: 302 } },
      { id: 'object-airliner', label: 'Airliner', src: '/elements/images/objects/object-airliner.png', defaultSize: { width: 430, height: 132 } },
      { id: 'object-cloud', label: 'Cloud', src: '/elements/images/objects/object-cloud.png', defaultSize: { width: 430, height: 283 } },
      { id: 'object-cloud-puff', label: 'Cloud puff', src: '/elements/images/objects/object-cloud-puff.png', defaultSize: { width: 430, height: 291 } },
      { id: 'object-cloud-band', label: 'Cloud band', src: '/elements/images/objects/object-cloud-band.png', defaultSize: { width: 403, height: 430 } },
      { id: 'object-cloud-valley', label: 'Cloud valley', src: '/elements/images/objects/object-cloud-valley.png', defaultSize: { width: 409, height: 430 } },
      { id: 'object-alarm-clock', label: 'Alarm clock', src: '/data/projects/sunup-clock.png', defaultSize: { width: 430, height: 430 } },
      { id: 'object-glow', label: 'Warm glow', src: '/data/projects/sunup-glow.png', defaultSize: { width: 430, height: 430 } },
      { id: 'object-app-heart', label: 'Heart app icon', src: '/elements/images/objects/object-app-heart.png', defaultSize: { width: 387, height: 430 } },
      { id: 'object-app-hash', label: 'Hashtag app icon', src: '/elements/images/objects/object-app-hash.png', defaultSize: { width: 412, height: 430 } },
      { id: 'object-app-globe', label: 'Globe app icon', src: '/elements/images/objects/object-app-globe.png', defaultSize: { width: 430, height: 429 } },
      { id: 'object-app-gallery', label: 'Gallery app icon', src: '/elements/images/objects/object-app-gallery.png', defaultSize: { width: 430, height: 429 } },
      { id: 'object-app-lens', label: 'Camera app icon', src: '/elements/images/objects/object-app-lens.png', defaultSize: { width: 415, height: 430 } },
      { id: 'object-lightbulb', label: 'Lightbulb', src: '/elements/images/objects/object-lightbulb.png', defaultSize: { width: 394, height: 430 } },
      { id: 'object-brain', label: 'Brain', src: '/elements/images/objects/object-brain.png', defaultSize: { width: 430, height: 394 } },
      { id: 'object-puzzle', label: 'Puzzle pieces', src: '/elements/images/objects/object-puzzle.png', defaultSize: { width: 430, height: 341 } },
      { id: 'object-trophy', label: 'Trophy', src: '/elements/images/objects/object-trophy.png', defaultSize: { width: 336, height: 430 } },
      { id: 'object-flame', label: 'Flame', src: '/elements/images/objects/object-flame.png', defaultSize: { width: 269, height: 430 } },
      { id: 'object-hand-peace', label: 'Peace hand', src: '/elements/images/objects/object-hand-peace.png', defaultSize: { width: 273, height: 430 } },
      { id: 'object-chat-bubble', label: 'Chat bubble', src: '/elements/images/objects/object-chat-bubble.png', defaultSize: { width: 430, height: 357 } },
      { id: 'object-check', label: 'Check badge', src: '/elements/images/objects/object-check.png', defaultSize: { width: 370, height: 430 } },
      { id: 'object-calendar', label: 'Calendar', src: '/elements/images/objects/object-calendar.png', defaultSize: { width: 364, height: 430 } },
      { id: 'object-clock', label: 'Clock', src: '/elements/images/objects/object-clock.png', defaultSize: { width: 356, height: 430 } },
    ],
  },
  {
    id: 'stickers',
    label: 'Stickers',
    items: [
      { id: 'sticker-smiley', label: 'Smiley', src: '/elements/images/stickers/sticker-smiley.png', defaultSize: { width: 430, height: 429 } },
      { id: 'sticker-eyes', label: 'Googly eyes', src: '/elements/images/stickers/sticker-eyes.png', defaultSize: { width: 430, height: 303 } },
      { id: 'sticker-drop', label: 'Water drop', src: '/elements/images/stickers/sticker-drop.png', defaultSize: { width: 342, height: 430 } },
      { id: 'sticker-dumbbell', label: 'Dumbbell', src: '/elements/images/stickers/sticker-dumbbell.png', defaultSize: { width: 430, height: 404 } },
      { id: 'sticker-treadmill', label: 'Treadmill', src: '/elements/images/stickers/sticker-treadmill.png', defaultSize: { width: 430, height: 390 } },
      { id: 'sticker-fire', label: 'Fireball', src: '/elements/images/stickers/sticker-fire.png', defaultSize: { width: 429, height: 430 } },
      { id: 'sticker-flag-us', label: 'US flag', src: '/elements/images/stickers/sticker-flag-us.png', defaultSize: { width: 430, height: 430 } },
      { id: 'sticker-flag-uk', label: 'UK flag', src: '/elements/images/stickers/sticker-flag-uk.png', defaultSize: { width: 430, height: 430 } },
      { id: 'sticker-flag-ca', label: 'Canada flag', src: '/elements/images/stickers/sticker-flag-ca.png', defaultSize: { width: 430, height: 430 } },
      { id: 'sticker-sunglasses', label: 'Pink sunglasses', src: '/elements/images/stickers/sticker-sunglasses.png', defaultSize: { width: 430, height: 223 } },
      { id: 'sticker-earphones', label: 'Earphones', src: '/elements/images/stickers/sticker-earphones.png', defaultSize: { width: 236, height: 430 } },
      { id: 'sticker-handbag', label: 'Handbag', src: '/elements/images/stickers/sticker-handbag.png', defaultSize: { width: 430, height: 401 } },
      { id: 'sticker-confetti', label: 'Confetti', src: '/elements/images/stickers/sticker-confetti.png', defaultSize: { width: 399, height: 430 } },
      { id: 'sticker-hand-pencil', label: 'Hand with pencil', src: '/elements/images/stickers/sticker-hand-pencil.png', defaultSize: { width: 430, height: 426 } },
      { id: 'sticker-confetti-strips', label: 'Confetti strips', src: '/elements/images/stickers/sticker-confetti-strips.png', defaultSize: { width: 261, height: 430 } },
    ],
  },
  {
    id: 'products',
    label: 'Products',
    items: [
      { id: 'product-cap', label: 'Baseball cap', src: '/elements/images/products/product-cap.png', defaultSize: { width: 430, height: 322 } },
      { id: 'product-blazer', label: 'Blazer', src: '/elements/images/products/product-blazer.png', defaultSize: { width: 280, height: 430 } },
      { id: 'product-shirt', label: 'Shirt', src: '/elements/images/products/product-shirt.png', defaultSize: { width: 345, height: 430 } },
      { id: 'product-hoodie', label: 'Hoodie', src: '/elements/images/products/product-hoodie.png', defaultSize: { width: 430, height: 394 } },
      { id: 'product-perfume', label: 'Perfume', src: '/elements/images/products/product-perfume.png', defaultSize: { width: 266, height: 430 } },
      { id: 'product-perfume-porcelain', label: 'Porcelain perfume', src: '/elements/images/products/product-perfume-porcelain.png', defaultSize: { width: 188, height: 430 } },
      { id: 'product-lip-tint', label: 'Lip tint', src: '/elements/images/products/product-lip-tint.png', defaultSize: { width: 107, height: 430 } },
      { id: 'product-earbuds', label: 'Earbuds', src: '/elements/images/products/product-earbuds.png', defaultSize: { width: 430, height: 351 } },
      { id: 'product-sunglasses-amber', label: 'Amber sunglasses', src: '/elements/images/products/product-sunglasses-amber.png', defaultSize: { width: 430, height: 195 } },
      { id: 'product-necklace', label: 'Heart necklace', src: '/elements/images/products/product-necklace.png', defaultSize: { width: 430, height: 379 } },
      { id: 'product-gold-rings', label: 'Gold rings', src: '/elements/images/products/product-gold-rings.png', defaultSize: { width: 430, height: 339 } },
      { id: 'product-gold-chain', label: 'Gold chain', src: '/elements/images/products/product-gold-chain.png', defaultSize: { width: 175, height: 430 } },
      { id: 'product-crystal-bag', label: 'Crystal bag', src: '/elements/images/products/product-crystal-bag.png', defaultSize: { width: 286, height: 430 } },
      { id: 'product-phone-orange', label: 'Orange phone', src: '/elements/images/products/product-phone-orange.png', defaultSize: { width: 352, height: 430 } },
      { id: 'product-oven-mitts', label: 'Oven mitts', src: '/elements/images/products/product-oven-mitts.png', defaultSize: { width: 430, height: 399 } },
    ],
  },
  {
    id: 'cards',
    label: 'Cards',
    items: [
      { id: 'card-soup', label: 'Soup fixes everything', src: '/elements/images/cards/card-soup.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-cat', label: 'Hello cat', src: '/elements/images/cards/card-cat.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-bunny', label: 'Bunny love', src: '/elements/images/cards/card-bunny.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-oldie', label: 'Birthday hat', src: '/elements/images/cards/card-oldie.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-lettuce', label: 'Lettuce celebrate', src: '/elements/images/cards/card-lettuce.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-mugs', label: 'Thank you mugs', src: '/elements/images/cards/card-mugs.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-cats', label: 'Cozy cats', src: '/elements/images/cards/card-cats.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-person', label: 'You are my person', src: '/elements/images/cards/card-person.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-birds', label: 'Anniversary birds', src: '/elements/images/cards/card-birds.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-dance', label: 'Go get them', src: '/elements/images/cards/card-dance.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-yourself', label: 'Be yourself', src: '/elements/images/cards/card-yourself.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-crime', label: 'Partners in crime', src: '/elements/images/cards/card-crime.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-kicking', label: 'Still kicking', src: '/elements/images/cards/card-kicking.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-street', label: 'Best friends', src: '/elements/images/cards/card-street.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-home', label: 'Home sweet home', src: '/elements/images/cards/card-home.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-cake', label: 'Birthday cake', src: '/elements/images/cards/card-cake.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-dog', label: 'Love you dog', src: '/elements/images/cards/card-dog.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-matter', label: 'You matter', src: '/elements/images/cards/card-matter.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-roses', label: 'Roses', src: '/elements/images/cards/card-roses.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-minds', label: 'We get each other', src: '/elements/images/cards/card-minds.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-love', label: 'Sending love', src: '/elements/images/cards/card-love.png', defaultSize: { width: 307, height: 430 } },
      { id: 'card-space', label: 'Out of this world', src: '/elements/images/cards/card-space.png', defaultSize: { width: 325, height: 430 } },
    ],
  },
  {
    id: 'drawings',
    label: 'Drawings',
    items: [
      { id: 'drawing-raccoon', label: 'Raccoon', src: '/elements/images/drawings/drawing-raccoon.png', defaultSize: { width: 417, height: 430 } },
      { id: 'drawing-raccoon-line', label: 'Raccoon outline', src: '/elements/images/drawings/drawing-raccoon-line.png', defaultSize: { width: 417, height: 430 } },
      { id: 'drawing-owl', label: 'Owl', src: '/elements/images/drawings/drawing-owl.png', defaultSize: { width: 376, height: 430 } },
      { id: 'drawing-rocket', label: 'Rocket', src: '/elements/images/drawings/drawing-rocket.png', defaultSize: { width: 389, height: 430 } },
      { id: 'drawing-milkshake', label: 'Milkshake', src: '/elements/images/drawings/drawing-milkshake.png', defaultSize: { width: 199, height: 430 } },
      { id: 'drawing-cupcake', label: 'Cupcake', src: '/elements/images/drawings/drawing-cupcake.png', defaultSize: { width: 320, height: 430 } },
      { id: 'drawing-eye-1', label: 'Eye, step 1', src: '/elements/images/drawings/drawing-eye-1.png', defaultSize: { width: 430, height: 430 } },
      { id: 'drawing-eye-2', label: 'Eye, step 2', src: '/elements/images/drawings/drawing-eye-2.png', defaultSize: { width: 430, height: 430 } },
      { id: 'drawing-eye-3', label: 'Eye, step 3', src: '/elements/images/drawings/drawing-eye-3.png', defaultSize: { width: 430, height: 430 } },
      { id: 'drawing-eye-4', label: 'Eye, step 4', src: '/elements/images/drawings/drawing-eye-4.png', defaultSize: { width: 430, height: 430 } },
      { id: 'drawing-eye-5', label: 'Eye, step 5', src: '/elements/images/drawings/drawing-eye-5.png', defaultSize: { width: 430, height: 430 } },
    ],
  },
  {
    id: 'sketches',
    label: 'Sketches',
    items: [
      { id: 'sketch-portrait-1', label: 'Pencil portrait 1', src: '/elements/images/sketches/sketch-portrait-1.png', defaultSize: { width: 339, height: 430 } },
      { id: 'sketch-portrait-2', label: 'Pencil portrait 2', src: '/elements/images/sketches/sketch-portrait-2.png', defaultSize: { width: 339, height: 430 } },
      { id: 'sketch-portrait-3', label: 'Pencil portrait 3', src: '/elements/images/sketches/sketch-portrait-3.png', defaultSize: { width: 339, height: 430 } },
      { id: 'sketch-portrait-4', label: 'Pencil portrait 4', src: '/elements/images/sketches/sketch-portrait-4.png', defaultSize: { width: 339, height: 430 } },
      { id: 'sketch-portrait-5', label: 'Pencil portrait 5', src: '/elements/images/sketches/sketch-portrait-5.png', defaultSize: { width: 339, height: 430 } },
      { id: 'sketch-portrait-6', label: 'Pencil portrait 6', src: '/elements/images/sketches/sketch-portrait-6.png', defaultSize: { width: 339, height: 430 } },
      { id: 'sketch-portrait-7', label: 'Pencil portrait 7', src: '/elements/images/sketches/sketch-portrait-7.png', defaultSize: { width: 339, height: 430 } },
      { id: 'sketch-painted-1', label: 'Painted portrait 1', src: '/elements/images/sketches/sketch-painted-1.png', defaultSize: { width: 363, height: 430 } },
      { id: 'sketch-painted-2', label: 'Painted portrait 2', src: '/elements/images/sketches/sketch-painted-2.png', defaultSize: { width: 363, height: 430 } },
      { id: 'sketch-painted-3', label: 'Painted portrait 3', src: '/elements/images/sketches/sketch-painted-3.png', defaultSize: { width: 363, height: 430 } },
    ],
  },
  {
    id: 'line-art',
    label: 'Line art',
    items: [
      { id: 'line-art-bedtime', label: 'Asleep in bed', src: '/elements/images/line-art/line-art-bedtime.png', defaultSize: { width: 430, height: 336 } },
      { id: 'line-art-coin', label: 'Coin', src: '/elements/images/line-art/line-art-coin.png', defaultSize: { width: 415, height: 430 } },
      { id: 'line-art-coin-phone', label: 'Coin going into a phone', src: '/elements/images/line-art/line-art-coin-phone.png', defaultSize: { width: 430, height: 231 } },
      { id: 'line-art-scarf', label: 'Wrapped in a scarf', src: '/elements/images/line-art/line-art-scarf.png', defaultSize: { width: 430, height: 362 } },
      { id: 'line-art-grater', label: 'Grating cash', src: '/elements/images/line-art/line-art-grater.png', defaultSize: { width: 430, height: 329 } },
      { id: 'line-art-meditate', label: 'Meditating', src: '/elements/images/line-art/line-art-meditate.png', defaultSize: { width: 430, height: 351 } },
    ],
  },
];
