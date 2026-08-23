/**
 * How a result card sizes and simplifies the boards it shows.
 *
 * Both problems here come from the same place: the deck mixes five different
 * canvas shapes and an unknown number of WebGL contexts, and neither can be
 * handled with a constant.
 */

import type { ArtboardState, DeviceFrameElementProps, Size } from '@/types/artboard';

/**
 * Every card's boards are this tall, so the deck reads as one row of cards.
 *
 * Sized backwards from the dialog: three phone boards at this height plus the
 * card's own padding is about 428px, and three of those cards fit across the
 * 1400px start dialog with room for the gaps. Any taller and the deck drops to
 * two cards a row, which halves how much of the catalog is visible at once.
 */
const DECK_BOARD_HEIGHT = 280;
/**
 * The widest strip of boards a card will show.
 *
 * Two constraints meet here. A phone card has to fit THREE boards, because two
 * reads as a fragment of a design rather than a design. And the widest card,
 * which is a single Mac or feature graphic board, still has to leave three
 * cards across the 1400px dialog. At 280 tall a phone board is 129 wide, so
 * three plus two gaps is 404, and a 406 cap puts every card between 234 and
 * 430px.
 */
const DECK_STRIP_WIDTH = 406;
const BOARD_GAP = 8;

export interface DeckBoardBox {
  boardHeight: number;
  boardWidth: number;
  boardsShown: number;
}

/**
 * Size a card's boards from its own canvas.
 *
 * Sizing by WIDTH, which is the obvious thing, is wrong here: at a fixed 116px
 * wide a phone board is 251px tall and a Mac board is 72px, so a deck holding
 * both looks broken. Height is the shared dimension, so every card lines up and
 * flex-wrap absorbs the differing widths.
 *
 * Checked against the five canvas shapes actually in the catalog: a phone
 * (0.461) gives 138 by 300 and three boards, a Mac (1.6) gives 430 by 269 and
 * one, a watch (0.821) gives 246 by 300 and one, a feature graphic (2.048)
 * gives 430 by 210 and one.
 */
export function deckBoardBox(canvas: Size): DeckBoardBox {
  const aspect = canvas.height > 0 ? canvas.width / canvas.height : 0.4614;
  let boardHeight = DECK_BOARD_HEIGHT;
  let boardWidth = boardHeight * aspect;
  if (boardWidth > DECK_STRIP_WIDTH) {
    boardWidth = DECK_STRIP_WIDTH;
    boardHeight = boardWidth / aspect;
  }
  const boardsShown = Math.max(
    1,
    Math.min(3, Math.floor((DECK_STRIP_WIDTH + BOARD_GAP) / (boardWidth + BOARD_GAP)))
  );
  return { boardHeight, boardWidth, boardsShown };
}

/**
 * The same board with its 3D device frames rendered flat.
 *
 * A 3D frame builds its own THREE.WebGLRenderer, and the browser evicts the
 * oldest context once roughly sixteen are alive, blanking whatever it evicted.
 * So a deck has a budget. The important part is what happens to a card that
 * cannot have one: showing it the shipped stock preview instead would hide the
 * user's own screenshots, which is the entire point of the card. Downgrading
 * the frame to the flat renderer keeps the screenshot, the background, the copy
 * and the composition, and gives up only the perspective on the phone body.
 *
 * The test matches `count3dDevices` in StaticArtboard exactly, so the two can
 * never disagree about what costs a context.
 */
export function flattenBoard3d(board: ArtboardState): ArtboardState {
  let changed = false;
  const elements = board.elements.map((element) => {
    if (element.type !== 'device') return element;
    const device = element as DeviceFrameElementProps;
    if (device.styleType !== '3d-left' && device.styleType !== '3d-right') return element;
    changed = true;
    return { ...device, styleType: 'normal' as const };
  });
  return changed ? { ...board, elements } : board;
}
