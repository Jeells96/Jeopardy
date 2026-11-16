// Christmas-themed "you've been summoned" lines for mini games played at more than one table.
// {who} is the name(s) drawn, {table} is where they need to go. The engine picks a line that
// hasn't been used recently, so every draw reads differently.
export const SUMMONS = [
  "🦌 Rudolph's nose is pointing straight at {who} — guide your sleigh to {table}!",
  "🎅 Santa checked his list twice: {who}, report to {table}!",
  "🧝 The elves have spoken! {who}, your workshop station is {table}.",
  "🔔 Jingle all the way to {table}, {who}!",
  "❄️ A snowflake landed on {who}'s name — drift on over to {table}!",
  "📜 Hear ye, hear ye! By order of the North Pole, {who} must appear at {table}!",
  "🍪 {who}, the cookies are waiting at {table}. Don't keep them waiting!",
  "🛷 Dasher, Dancer… and {who}! Sleigh parking is at {table}.",
  "⛄ Frosty says {who} should waddle over to {table} before you melt!",
  "🎁 Special delivery! One {who}, wrapped and shipped to {table}.",
  "🌟 Follow the star, {who} — it's shining over {table}!",
  "🧦 {who}, your stocking has been hung at {table}. Go claim it!",
  "🎄 Deck the halls and head to {table}, {who}!",
  "🥛 Milk's poured, cookies are out — {who}, take your seat at {table}!",
  "🧣 Bundle up, {who}! The blizzard is blowing you toward {table}.",
  "📯 The reindeer games have begun! {who}, gallop to {table}.",
  "🍬 Candy cane lane leads right to {table}. Off you go, {who}!",
  "🕯️ The Christmas candles are lit at {table} — {who}, you're expected!",
  "🎶 Fa-la-la-la-la, {who} to {table}, la-la-la-la!",
  "🧸 The toy shop foreman needs {who} at {table}, pronto!",
  "🌨️ Let it snow, let it snow, let {who} go… to {table}!",
  "🦉 Mrs. Claus spotted {who} — she says scoot to {table}, dear!",
  "🎀 {who}, put a bow on it and bring yourself to {table}!",
  "🏔️ North Pole dispatch: {who} is cleared for landing at {table}.",
  "🍫 Hot cocoa break is over, {who} — report to {table}!",
  "🎅 Ho ho HOLD everything! {who} is needed at {table}!",
  "🧑‍🎄 The naughty-or-nice committee requests {who} at {table}.",
  "🛎️ Sleigh bells are ringing for {who} — they're ringing at {table}!",
  "🎇 Fire up the twinkle lights! {who}, your spotlight is at {table}.",
  "🥧 A fresh pie just came out of the oven at {table}. Go get it, {who}!",
  "🐧 The penguins slid a note under the door: “{who} → {table}.”",
  "🧊 Don't be a frozen snowman, {who}! Hustle to {table}.",
  "🎺 The marching toy soldiers will escort {who} to {table}!",
  "📮 A letter from the North Pole says: “Dear {who}, please see {table}.”",
  "🌲 Under the tree at {table}, there's a present with {who}'s name on it!",
  "🥁 Pa-rum-pum-pum-pum! {who}, drum your way over to {table}.",
];

// Fill in a line. names: one or two names; table: the table's name.
export function summonText(index, names, table) {
  const line = SUMMONS[((Number(index) % SUMMONS.length) + SUMMONS.length) % SUMMONS.length];
  const list = (names || []).filter(Boolean);
  const who = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0] || "Everyone";
  return line.replaceAll("{who}", who).replaceAll("{table}", table || "the table");
}
