// Static imports of every list, for verification on the server. Apart from
// index.ts because importing this module puts all six lists in the bundle.
import en200v1 from './en-200@1.json';
import en1kV1 from './en-1k@1.json';
import en5kV1 from './en-5k@1.json';
import pt200v1 from './pt-200@1.json';
import pt1kV1 from './pt-1k@1.json';
import pt5kV1 from './pt-5k@1.json';
import { isPackId, type Pack, type PackId } from './index';

const ALL: Readonly<Record<PackId, Pack>> = {
  'en-200@1': en200v1 as Pack,
  'en-1k@1': en1kV1 as Pack,
  'en-5k@1': en5kV1 as Pack,
  'pt-200@1': pt200v1 as Pack,
  'pt-1k@1': pt1kV1 as Pack,
  'pt-5k@1': pt5kV1 as Pack,
};

/** Takes a plain string because the id comes from a stored ticket or result. */
export function findPack(id: string): Pack | undefined {
  return isPackId(id) ? ALL[id] : undefined;
}
