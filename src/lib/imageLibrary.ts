/**
 * Library of ready-made image assets for the Images palette tab.
 *
 * Photo groups: Adobe Stock (free collection) photos licensed through the
 * project owner's Adobe account and background-removed; filenames embed the
 * Stock asset ID (<group>-as<ID>.png). Badges: official vendor marketing
 * badges from each store's badge program. Full license record:
 * docs/image-asset-licenses.md.
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
];
