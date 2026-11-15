// The community feed the fake backend serves: fictional people and the repo's
// own template art. Image paths are served from REPO/public by rig.cjs.
const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;

const OFFICIAL = {
  id: 'osg-official',
  handle: 'openscreenshot',
  name: 'Open Screenshot Generator',
  verified: true,
  followers: 2410,
};
const people = {
  priya: { id: 'u-priya', handle: 'priyamakes', name: 'Priya Nair', followers: 342 },
  leo: { id: 'u-leo', handle: 'leobrandt', name: 'Leo Brandt', followers: 118 },
  ines: { id: 'u-ines', handle: 'inesdraws', name: 'Ines Okafor', followers: 905 },
  tomas: { id: 'u-tomas', handle: 'tomasbuilds', name: 'Tomas Ruiz', followers: 61 },
  hana: { id: 'u-hana', handle: 'hanasato', name: 'Hana Sato', followers: 277 },
  sam: { id: 'promo-viewer', handle: 'samrivera', name: 'Sam Rivera', followers: 128, isViewer: true },
};

function post(id, author, title, caption, tags, preview, stats, hoursAgo, extra = {}) {
  return {
    id,
    author,
    title,
    caption,
    tags,
    surface: 'screenshots',
    images: [{ id: id + '-1', src: preview, aspect: '3 / 1', fit: 'contain', label: title }],
    screens: 5,
    createdAt: new Date(Date.now() - hoursAgo * HOUR).toISOString(),
    stats,
    ...extra,
  };
}

function feedPosts() {
  return [
    post(
      'p-somnia',
      people.ines,
      'Somnia Sleep',
      'Night sky set for our sleep app, the moon follows you from screen to screen',
      ['sleep', 'darkmode', 'calm'],
      '/data/projects/previews/somnia-sleep.png',
      { likes: 214, comments: 18, views: 3120, remixes: 96 },
      20,
      { templateProjectId: 'template_somnia-sleep', featured: true, appName: 'Somnia Sleep' }
    ),
    post(
      'p-kassa',
      people.priya,
      'Kassa Money',
      'Our spring update set, green tested better than blue for us',
      ['finance', 'green', 'bold'],
      '/data/projects/previews/kassa-money.png',
      { likes: 167, comments: 11, views: 2480, remixes: 64 },
      30,
      { templateProjectId: 'template_kassa-money', appName: 'Kassa Money' }
    ),
    post(
      'p-tripora',
      people.leo,
      'Tripora Travel',
      'Five screens, five places, one swipe through the whole trip',
      ['travel', 'photo', 'bright'],
      '/data/projects/previews/tripora-travel.png',
      { likes: 121, comments: 9, views: 1890, remixes: 41 },
      9,
      { templateProjectId: 'template_tripora-travel', appName: 'Tripora Travel' }
    ),
    post(
      'p-cinevault',
      OFFICIAL,
      'Cinevault',
      'A built-in template. Open it as a starting point and change anything',
      ['movies', 'darkmode', 'bold'],
      '/data/projects/previews/cinevault-stream.png',
      { likes: 98, comments: 6, views: 2240, remixes: 170 },
      2 * 24 + 5,
      { templateProjectId: 'template_cinevault-stream' }
    ),
    post(
      'p-verda',
      people.hana,
      'Verda Eco',
      'Soft greens and big type, made in an afternoon',
      ['eco', 'minimal', 'pastel'],
      '/data/projects/previews/verda-eco.png',
      { likes: 87, comments: 4, views: 1210, remixes: 28 },
      14,
      { templateProjectId: 'template_verda-eco', appName: 'Verda Eco' }
    ),
    post(
      'p-plannio',
      people.tomas,
      'Plannio Student',
      'Our first store set, the timetable screen does most of the work',
      ['education', 'productivity'],
      '/data/projects/previews/plannio-student.png',
      { likes: 64, comments: 7, views: 940, remixes: 19 },
      6,
      { templateProjectId: 'template_plannio-student', appName: 'Plannio Student' }
    ),
  ];
}

function juniperPost() {
  return post(
    'p-juniper',
    people.sam,
    'Juniper: Habit Tracker',
    'Our launch set, in four languages',
    ['habits', 'green', 'launch'],
    '/promo-art/juniper-strip.png',
    { likes: 236, comments: 21, views: 3480, remixes: 52 },
    3,
    { appName: 'Juniper', featured: true, isMine: true }
  );
}

module.exports = { feedPosts, juniperPost, people, OFFICIAL, DAY, HOUR };
