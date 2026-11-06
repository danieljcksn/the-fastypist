# Word lists: attribution and licence

The word lists in this folder (`en-200`, `en-1k`, `en-5k`, `pt-200`, `pt-1k`, `pt-5k`) are adapted from FrequencyWords.

| | |
| --- | --- |
| Title | FrequencyWords, `content/2018`, lists `en_50k` and `pt_br_50k` |
| Author | Hermit Dave |
| Copyright notice | Copyright (c) 2016 Hermit Dave, as it appears in the source repository's `LICENSE` |
| Source | https://github.com/hermitdave/FrequencyWords |
| Version used | Commit `525f9b560de45753a5ea01069454e72e9aa541c6` |
| Licence of the content | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| Underlying corpus | [OpenSubtitles 2018](http://opus.nlpl.eu/OpenSubtitles2018.php), as named by the source, built from subtitles at http://www.opensubtitles.org/ |
| Corpus citation | P. Lison and J. Tiedemann, 2016, OpenSubtitles2016: Extracting Large Parallel Corpora from Movie and TV Subtitles. In Proceedings of the 10th International Conference on Language Resources and Evaluation (LREC 2016) |

## What we changed

These lists are adapted: filtered and reviewed. We dropped the source's occurrence counts. From the source lists we removed words that fail a spelling dictionary, words longer than 14 letters, words with characters other than letters, and words a person removed by hand (profanity, slurs, proper names, abbreviations, interjections, foreign words, misspellings, subtitle captions and credits, and words about death or violence). We cut what remained to its 200, 1,000 and 5,000 most frequent words, keeping the source's frequency order.

## Licence of these lists

These adapted lists are themselves licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The source lists and these lists come with no warranties: see Section 5 of the licence for the disclaimer and the limitation of liability. The licence covers the `*.json` word lists in this folder and the review files in `data/review/`, which contain words from the same source. It does not cover the code in this repository.

## Used to build, not distributed

Two spelling dictionaries decided which words count as real words. Neither they nor any part of them ships in these lists.

- English: [dictionary-en 4.0.0](https://github.com/wooorm/dictionaries), derived from [SCOWL](http://wordlist.sourceforge.net), under SCOWL's own permissive licence.
- Brazilian Portuguese: [dictionary-pt 4.0.0](https://github.com/wooorm/dictionaries), derived from VERO by Raimundo Moura, under LGPL-3.0 or MPL-2.0.

Hand review used two profanity lists as a queue of words to read: [cuss](https://github.com/words/cuss) (MIT) and [LDNOOBW](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words) (CC BY 4.0).
