'use strict';

// Each entry is a pair of related-but-distinct words. Most players get
// `civilian`, one or more randomly chosen players get `spy`. Kept as a
// static in-code list (small, curated) rather than a DB table - matches
// the mission-definitions / diamond-packages pattern used elsewhere for
// small, release-versioned content.
const WORD_PAIRS = [
  { civilian: 'Coffee', spy: 'Tea' },
  { civilian: 'Beach', spy: 'Lake' },
  { civilian: 'Doctor', spy: 'Nurse' },
  { civilian: 'Pizza', spy: 'Pasta' },
  { civilian: 'Airplane', spy: 'Helicopter' },
  { civilian: 'Guitar', spy: 'Violin' },
  { civilian: 'Football', spy: 'Rugby' },
  { civilian: 'Library', spy: 'Bookstore' },
  { civilian: 'Volcano', spy: 'Mountain' },
  { civilian: 'Sushi', spy: 'Ramen' },
  { civilian: 'Winter', spy: 'Autumn' },
  { civilian: 'Castle', spy: 'Palace' },
  { civilian: 'Photographer', spy: 'Painter' },
  { civilian: 'Subway', spy: 'Bus' },
  { civilian: 'Chess', spy: 'Checkers' },
];

function getRandomWordPair() {
  return WORD_PAIRS[Math.floor(Math.random() * WORD_PAIRS.length)];
}

module.exports = { WORD_PAIRS, getRandomWordPair };
