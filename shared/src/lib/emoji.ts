/** Splits a string into user-perceived characters so ZWJ sequences stay intact. */
function graphemes(value: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter;
  const parts = Segmenter ? Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(value), (s) => s.segment) : Array.from(value);
  // Force emoji presentation for symbols that would otherwise render as text glyphs.
  return parts.map((p) => (/^\p{Extended_Pictographic}$/u.test(p) && !/\p{Emoji_Presentation}/u.test(p) ? p + "\ufe0f" : p));
}

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export const EMOJI_CATEGORIES: { id: string; label: string; icon: string; emojis: string[] }[] = [
  {
    id: "smileys",
    label: "Smileys",
    icon: "😀",
    emojis: graphemes(
      "😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗😚😙🥲😋😛😜🤪😝🤑🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬😮‍💨🤥😌😔😪🤤😴😷🤒🤕🤢🤮🥵🥶🥴😵🤯🤠🥳🥸😎🤓🧐😕😟🙁😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀💩🤡👻👽🤖😺😸😹😻😼😽🙀😿😾",
    ),
  },
  {
    id: "people",
    label: "Gestures",
    icon: "👋",
    emojis: graphemes(
      "👋🤚🖐✋🖖👌🤌🤏✌🤞🤟🤘🤙👈👉👆🖕👇☝👍👎✊👊🤛🤜👏🙌👐🤲🤝🙏✍💅🤳💪🦾🦵🦶👂🦻👃🧠👀👁👅👄💋👶🧒👦👧🧑👱👨🧔👩🧓👴👵🙍🙎🙅🙆💁🙋🧏🙇🤦🤷",
    ),
  },
  {
    id: "hearts",
    label: "Hearts",
    icon: "❤️",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "♥️", "💌", "💯", "💢", "💥", "💫", "💦", "💨", "🕳️", "💬", "💭", "💤", "✨", "⭐", "🌟", "🔥", "🎉", "🎊"],
  },
  {
    id: "nature",
    label: "Animals & Nature",
    icon: "🐶",
    emojis: graphemes(
      "🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐔🐧🐦🐤🦆🦅🦉🦇🐺🐗🐴🦄🐝🐛🦋🐌🐞🐜🪲🐢🐍🦎🐙🦑🦐🦀🐡🐠🐟🐬🐳🐋🦈🐊🐅🐆🦓🦍🐘🦛🦏🐪🦒🦘🐃🐄🐎🐖🐏🐑🐐🦌🐕🐩🐈🐓🦃🦚🦜🦢🌵🎄🌲🌳🌴🌱🌿☘🍀🍁🍂🍃🌷🌹🥀🌺🌸🌼🌻🌞🌝🌛🌜🌚🌕🌙🌎⭐🌈☀⛅☁🌧⛈🌩❄☃⛄🌊",
    ),
  },
  {
    id: "food",
    label: "Food & Drink",
    icon: "🍕",
    emojis: graphemes(
      "🍏🍎🍐🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🍆🥑🥦🥬🥒🌶🌽🥕🧄🧅🥔🍠🥐🥯🍞🥖🥨🧀🥚🍳🧈🥞🧇🥓🥩🍗🍖🌭🍔🍟🍕🥪🥙🧆🌮🌯🥗🥘🍝🍜🍲🍛🍣🍱🥟🍤🍙🍚🍘🍥🥮🍢🍡🍧🍨🍦🥧🧁🍰🎂🍮🍭🍬🍫🍿🍩🍪🌰🥜🍯🥛🍼☕🍵🧃🥤🧋🍶🍺🍻🥂🍷🥃🍸🍹🍾🧊",
    ),
  },
  {
    id: "activity",
    label: "Activities",
    icon: "⚽",
    emojis: graphemes(
      "⚽🏀🏈⚾🥎🎾🏐🏉🥏🎱🪀🏓🏸🏒🏑🥍🏏🥅⛳🪁🏹🎣🤿🥊🥋🎽🛹🛼🛷⛸🥌🎿⛷🏂🏋🤼🤸⛹🤺🤾🏌🏇🧘🏄🏊🤽🚣🧗🚵🚴🏆🥇🥈🥉🏅🎖🏵🎗🎫🎟🎪🎭🎨🎬🎤🎧🎼🎹🥁🎷🎺🎸🪕🎻🎲♟🎯🎳🎮🎰🧩",
    ),
  },
  {
    id: "travel",
    label: "Travel & Places",
    icon: "✈️",
    emojis: graphemes(
      "🚗🚕🚙🚌🚎🏎🚓🚑🚒🚐🛻🚚🚛🚜🛵🏍🛺🚲🛴🚨🚔🚍🚘🚖🚡🚠🚟🚃🚋🚞🚝🚄🚅🚈🚂🚆🚇🚊🚉✈🛫🛬🛩💺🛰🚀🛸🚁🛶⛵🚤🛥🛳⛴🚢⚓⛽🚧🚦🚥🗺🗿🗽🗼🏰🏯🏟🎡🎢🎠⛲⛱🏖🏝🏜🌋⛰🏔🗻🏕⛺🏠🏡🏘🏚🏗🏭🏢🏬🏣🏤🏥🏦🏨🏪🏫🏩💒🏛⛪🕌🕍🛕🕋⛩🛤🛣🗾🎑🏞🌅🌄🌠🎇🎆🌇🌆🏙🌃🌌🌉🌁",
    ),
  },
  {
    id: "objects",
    label: "Objects",
    icon: "💡",
    emojis: graphemes(
      "⌚📱📲💻⌨🖥🖨🖱🖲🕹🗜💽💾💿📀📼📷📸📹🎥📽🎞📞☎📟📠📺📻🎙🎚🎛🧭⏱⏲⏰🕰⌛⏳📡🔋🔌💡🔦🕯🪔🧯🛢💸💵💴💶💷💰💳💎⚖🧰🔧🔨⚒🛠⛏🔩⚙🧱⛓🧲🔫💣🧨🪓🔪🗡⚔🛡🚬⚰⚱🏺🔮📿🧿💈⚗🔭🔬🕳🩹🩺💊💉🩸🧬🦠🧫🧪🌡🧹🧺🧻🚽🚰🚿🛁🛀🧼🪒🧽🧴🛎🔑🗝🚪🪑🛋🛏🛌🧸🖼🛍🛒🎁🎈🎏🎀🎊🎉🎎🏮🎐🧧✉📩📨📧💌📥📤📦🏷📪📫📬📭📮📯📜📃📄📑🧾📊📈📉🗒🗓📆📅🗑📇🗃🗳🗄📋📁📂🗂🗞📰📓📔📒📕📗📘📙📚📖🔖🧷🔗📎🖇📐📏🧮📌📍✂🖊🖋✒🖌🖍📝✏🔍🔎🔏🔐🔒🔓",
    ),
  },
  {
    id: "symbols",
    label: "Symbols",
    icon: "✅",
    emojis: graphemes(
      "✅☑✔❌❎➕➖➗✖♾‼⁉❓❔❕❗〰💱💲⚕♻⚜🔱📛🔰⭕✳❇🆗🆒🆕🆓🆙🆘🚫⛔📵🔞☢☣⬆↗➡↘⬇↙⬅↖↕↔↩↪⤴⤵🔃🔄🔙🔚🔛🔜🔝🛐⚛🕉✡☸☯✝☦☪☮🕎🔯♈♉♊♋♌♍♎♏♐♑♒♓⛎🔀🔁🔂▶⏩⏭⏯◀⏪⏮🔼⏫🔽⏬⏸⏹⏺⏏🎦🔅🔆📶📳📴♀♂⚧©®™🔟🔠🔡🔢🔣🔤🅰🆎🅱🆑🅾🆔Ⓜ🆖🅿🆚🈁🔴🟠🟡🟢🔵🟣🟤⚫⚪🟥🟧🟨🟩🟦🟪🟫⬛⬜◼◻◾◽▪▫🔶🔷🔸🔹🔺🔻💠🔘🔳🔲🏁🚩🎌🏴🏳",
    ),
  },
];
