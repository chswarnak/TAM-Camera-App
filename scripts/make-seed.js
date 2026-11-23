'use strict';
// One-off generator for data/seed.json. Options are shuffled once here so the
// correct answer is not always "A"; `answer` is the index of the right option.
const fs = require('node:fs');
const path = require('node:path');

let s = 2026;
const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
function quiz(category, rows) {
  return rows.map(([text, ...opts]) => {
    const correct = opts[0];
    const options = [...opts].sort(() => rand() - 0.5);
    return { category, text, options, answer: options.indexOf(correct), seconds: 20, points: 10 };
  });
}

const seed = {
  // Placeholders only: PARTY_NAME and HOST_NAMES in .env override these at start.
  party: { name: 'Diwali Night', hosts: ['Your Family'] },
  teams: [
    { name: 'Diya', color: '#D4A017' },
    { name: 'Rangoli', color: '#E0457B' },
    { name: 'Phuljhari', color: '#2E9E5B' },
    { name: 'Ladoo', color: '#F07F1A' },
  ],
  quiz: [
    ...quiz('Bollywood Emoji', [
      ['🚂💑🇬🇧🌾', 'Dilwale Dulhania Le Jayenge', 'Kuch Kuch Hota Hai', 'Veer-Zaara', 'Jab We Met'],
      ['🎓3️⃣🤪', '3 Idiots', 'Munna Bhai MBBS', 'Chhichhore', 'Student of the Year'],
      ['🐒🧒🇵🇰🇮🇳', 'Bajrangi Bhaijaan', 'Sultan', 'Ek Tha Tiger', 'PK'],
      ['🏏🇮🇳🇬🇧🌾', 'Lagaan', '83', 'Chak De India', 'Dangal'],
      ['🤼‍♀️👧👧🥇', 'Dangal', 'Mary Kom', 'Sultan', 'Chak De India'],
      ['👽🔔📿', 'PK', 'Koi Mil Gaya', 'Krrish', 'OMG'],
      ['🚗🇪🇸🪂🐂', 'Zindagi Na Milegi Dobara', 'Dil Chahta Hai', 'Rock On', 'Dil Dhadakne Do'],
      ['👑⚔️🐘🏰', 'Baahubali', 'Padmaavat', 'Jodhaa Akbar', 'RRR'],
      ['👻🏚️💃🎶', 'Bhool Bhulaiyaa', 'Stree', 'Golmaal', 'Housefull'],
      ['💃🍶💔🏛️', 'Devdas', 'Mughal-E-Azam', 'Hum Dil De Chuke Sanam', 'Bajirao Mastani'],
    ]),
    ...quiz('Diwali Trivia', [
      ['Diwali celebrates the return of whom to Ayodhya?', 'Rama', 'Krishna', 'Hanuman', 'Arjuna'],
      ['How many days does Diwali traditionally span?', 'Five', 'Three', 'Seven', 'One'],
      ['Which goddess is worshipped on the main Diwali night?', 'Lakshmi', 'Saraswati', 'Durga', 'Parvati'],
      ['The day before Diwali is called?', 'Choti Diwali', 'Bhai Dooj', 'Dhanteras', 'Govardhan Puja'],
      ['Deepavali literally means?', 'Row of lamps', 'Festival of sweets', 'Night of fire', 'New year'],
      ['Dhanteras is traditionally the day to buy?', 'Gold or utensils', 'Clothes', 'Crackers', 'Sweets'],
      ['Bhai Dooj celebrates the bond between?', 'Brothers and sisters', 'Husband and wife', 'Parents and children', 'Neighbours'],
      ['For Jains, Diwali marks?', "Mahavira's nirvana", 'Birth of Mahavira', 'Start of the year', 'Harvest'],
      ['Sikhs celebrate which event around Diwali?', 'Bandi Chhor Divas', 'Vaisakhi', 'Gurpurab', 'Hola Mohalla'],
      ['Diwali falls on the new moon of which month?', 'Kartik', 'Chaitra', 'Shravan', 'Ashwin'],
    ]),
  ],
  polls: [
    ...[
      'Most likely to eat all the ladoos',
      'Most likely to arrive fashionably late',
      'Most likely to light a sparkler and run',
      'Most likely to win every game tonight',
      'Most likely to be found next to the food table',
      'Most likely to start the dance floor',
      'Most likely to take 100 selfies',
      'Most likely to cry at a Bollywood song',
      'Most likely to argue with the DJ',
      'Most likely to still be here at 2 am',
    ].map((text) => ({ text, mostLikely: true, options: [] })),
    { text: 'Best Diwali sweet of all time?', mostLikely: false, options: ['Ladoo', 'Jalebi', 'Kaju katli', 'Gulab jamun'] },
    { text: 'Best part of Diwali?', mostLikely: false, options: ['The food', 'The lights', 'The family', 'The dancing'] },
    { text: 'Which Bollywood era wins?', mostLikely: false, options: ['70s classics', '90s romance', '2000s masala', 'Today'] },
  ],
  // Guess Who clues come from guests' About Me cards; add host clues from the dashboard.
  guessWho: [],
  couplesQuestions: [
    'Who takes longer to get ready?',
    'Who is the better cook?',
    'Who said I love you first?',
    'Who is more likely to forget an anniversary?',
    'Who picks the movie?',
    'Who is the bigger foodie?',
    'Who apologises first after an argument?',
    'Who spends more on Diwali shopping?',
    'Who is the better dancer?',
    'Who falls asleep first on movie night?',
  ],
  titles: {
    ladoo: { first: 'Lord of the Early Ladoos', 'on time': 'Ladoo Timekeeper', 'fashionably late': 'Minister of Late Ladoos', 'after the food': 'Ladoo Last Call Legend' },
    jalebi: { first: 'Jalebi Early Bird', 'on time': 'Punctual Jalebi Pro', 'fashionably late': 'Jalebi Fashion Icon', 'after the food': 'Jalebi Midnight Raider' },
    'kaju katli': { first: 'Kaju Katli Trailblazer', 'on time': 'Captain Kaju Katli', 'fashionably late': 'Kaju Katli Runway Star', 'after the food': 'Kaju Katli Crumb Hunter' },
    'gulab jamun': { first: 'Gulab Jamun Gatekeeper', 'on time': 'Gulab Jamun General', 'fashionably late': 'Duchess of Gulab Jamun', 'after the food': 'Gulab Jamun Ghost' },
  },
  captions: [
    'Shine bright like a diya', 'Sparkle season', 'Family, lights and ladoos', 'Happy Diwali from us',
    'Lit, literally', 'Dil se Diwali', 'Rangoli ready', 'Lights on, phones up',
  ],
  commentator: [
    'Tight race at the top!', 'Someone is on fire tonight', 'The crowd goes wild',
    'Plot twist on the leaderboard', 'Ladoos for the leaders',
  ],
  stickers: [
    { id: 'diya', emoji: '🪔', text: 'You light up the room' },
    { id: 'sweet', emoji: '🍬', text: 'Sweetest person here' },
    { id: 'dance', emoji: '💃', text: 'Dance partner wanted' },
    { id: 'karaoke', emoji: '🎤', text: 'Karaoke king/queen' },
    { id: 'plate', emoji: '🍛', text: 'Best plate at the table' },
    { id: 'photo', emoji: '📸', text: 'Most photogenic' },
    { id: 'laugh', emoji: '😂', text: 'Made me laugh' },
    { id: 'mvp', emoji: '🏆', text: 'MVP' },
  ],
  aboutOptions: {
    sweet: ['ladoo', 'jalebi', 'kaju katli', 'gulab jamun'],
    superpower: ['teleport', 'invisibility', 'unlimited chai', 'mind reading'],
    arrival: ['first', 'on time', 'fashionably late', 'after the food'],
  },
  physicalGames: {
    hat: { name: 'Hat Game', rule: 'Pass the hat while the music plays. The couple holding the hat when it stops is out.', unit: 'Couples left' },
    cups: { name: 'Musical Cups', rule: 'Walk around the cups while the music plays. Grab a cup when it stops. No cup, you are out.', unit: 'Cups left' },
    hug: { name: 'Hug Your Partner', rule: 'Dance apart while the music plays. When it stops, find your partner and hug. Last couple to hug is out.', unit: 'Couples left' },
  },
};

fs.writeFileSync(path.join(__dirname, '..', 'data', 'seed.json'), `${JSON.stringify(seed, null, 2)}\n`);
console.log('wrote data/seed.json');
