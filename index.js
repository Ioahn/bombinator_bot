const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const {createChainAdapter} = require('./utils/chainAdapter')

// Вставьте ваш токен от BotFather
const TOKEN = '7934869419:AAGTYwFZAHk8vDSuHIhR_lERC4aM5b-1RV0';
const bot = new TelegramBot(TOKEN, {
    polling: {
        params: {
            offset: 0 // Берём только новые сообщения
        }
    }
});


const STICKERS_FILE = './stickers.json';
const EMOJI_FILE = './emoji.json';
const DICT_FILE = './dictionary.json';
const CHATS_FILE = './chats.json';
const REACTIONS = './reactions.json';

function getCustomEmojiObjects(word, emojiMapping) {
    const wordLetters = word.toLowerCase().split(''); // Разбиваем слово на буквы

    return wordLetters.map((letter) => {
        const emojiObject = emojiMapping.find(emoji => emoji.letter.toLowerCase() === letter);
        const emoji = emojiObject.emoji === '🔠' ? letter.toUpperCase() : emojiObject.emoji

        return `<tg-emoji emoji-id="${emojiObject.id}">${emoji}</tg-emoji>`
    }).join('')
}

function createRegExp(words) {
    // Экранируем специальные символы и создаём регулярное выражение
    const escapedWords = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // Регулярное выражение, игнорирующее пробелы и символы вокруг слов
    return new RegExp(`(?:^|\\W)(${escapedWords.join('|')})(?:$|\\W)`, 'i');
}

function getRandomElement(arr) {
    if (!Array.isArray(arr) || arr.length === 0) {
        throw new Error('Передайте непустой массив');
    }
    const randomIndex = Math.floor(Math.random() * arr.length);
    return arr[randomIndex];
}

function maskWord(word, previousMask = null) {
    if (typeof word !== 'string' || word.length === 0) {
        throw new Error('Передайте непустую строку');
    }

    if (previousMask === null) {
        // Если маски ранее не было, возвращаем маску с первой открытой буквой
        return word[0] + '*'.repeat(word.length - 1);
    }

    if (typeof previousMask !== 'string' || previousMask.length !== word.length) {
        throw new Error('Некорректная предыдущая маска');
    }

    // Определяем индекс следующей буквы для раскрытия
    const nextIndex = previousMask.indexOf('*');
    if (nextIndex === -1) {
        return previousMask; // Все буквы уже открыты
    }

    // Создаем новую маску с раскрытой следующей буквой
    return previousMask.slice(0, nextIndex) + word[nextIndex] + previousMask.slice(nextIndex + 1);
}

function getRandomNumber(min, max) {
    if (typeof min !== 'number' || typeof max !== 'number') {
        throw new Error('Параметры должны быть числами');
    }
    if (min > max) {
        throw new Error('Минимальное значение не может быть больше максимального');
    }
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

const transformMessage = (message) => {
    const {entities, text} = message;
    const emoji = text.split(' ')[0]; // Извлекаем эмодзи
    const letter = text.split('-')[1].trim(); // Извлекаем букву
    const type = entities.find(entity => entity.type === 'custom_emoji')?.custom_emoji_id; // Получаем custom_emoji_id

    return {emoji, type, letter};
};

const loadChats = () => {
    if (!fs.existsSync(CHATS_FILE)) {
        // Если файла нет, создаём пустой массив
        fs.writeFileSync(CHATS_FILE, JSON.stringify([]));
        return [];
    }

    const data = fs.readFileSync(CHATS_FILE, 'utf-8');
    return JSON.parse(data);
};

const loadReactions = () => {
    if (!fs.existsSync(REACTIONS)) {
        // Если файла нет, создаём пустой массив
        fs.writeFileSync(REACTIONS, JSON.stringify([]));
        return [];
    }

    const data = fs.readFileSync(REACTIONS, 'utf-8');
    return JSON.parse(data);
};

const saveChats = (chats) => {
    fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2));
};

const loadStickers = () => {
    if (!fs.existsSync(STICKERS_FILE)) {
        // Если файла нет, создаём пустой массив
        fs.writeFileSync(STICKERS_FILE, JSON.stringify([]));
        return [];
    }

    // Читаем и парсим файл
    const data = fs.readFileSync(STICKERS_FILE, 'utf-8');
    return JSON.parse(data);
};

const getNewWords = (array) => {
    return array.slice().sort(() => (-1) ** getRandomNumber(0, 10) % 3).slice(0, 10)
}

const loadDict = () => {
    if (!fs.existsSync(DICT_FILE)) {
        // Если файла нет, создаём пустой массив
        fs.writeFileSync(DICT_FILE, JSON.stringify([]));
        return [];
    }

    // Читаем и парсим файл
    const data = fs.readFileSync(DICT_FILE, 'utf-8');
    return JSON.parse(data);
};

const setWordRarity = (array) => {
    const indexes = [getRandomNumber(0, 3), getRandomNumber(4, 7), getRandomNumber(8, 10)]

    return array.map((wordOpts, i) => {
        if (indexes.includes(i)) {
            const rarity = getRandomNumber(2, 3);

            return {...wordOpts, rarity}
        }

        return {...wordOpts, rarity: 1}
    })
}

let TRIGGER_WORDS = setWordRarity(getNewWords(loadDict()));

let messageCounter = 0;
let hintedWord = null;

const spamers = new Map();
const players = new Set();

class Rating {
    ids = []
    entities = new Map()
    filePath = path.resolve(__dirname, 'rating.json');

    constructor() {
        this.loadFromFile()
    }

    has = (id) => {
        return this.entities.has(id)
    }


    addNewUser = (id, {username = 'неизвестный пидрила'}) => {
        if (this.entities.has(id)) {
            return
        }

        this.entities.set(id, {score: 0, username})
        this.ids.push(id)
    }

    updateUser = (id, newField) => {
        if (!this.entities.has(id)) {
            this.addNewUser(id, newField)

            return
        }

        const prevData = this.getRating(id);

        this.entities.set(id, {...prevData, ...newField})
        this.ids.sort((a, b) => this.entities.get(b).score - this.entities.get(a).score)
    }

    setNewScore = (id, score) => {
        const prevData = this.entities.get(id);

        this.entities.set(id, {...prevData, score})

        this.ids.sort((a, b) => this.entities.get(b).score - this.entities.get(a).score)
    }

    increaseScore = (id, by) => {
        const score = this.getRating(id).score || 0;

        this.setNewScore(id, score + by)

        return score + by
    }

    decreaseScore = (id, by) => {
        const score = this.getRating(id).score || 0;

        this.setNewScore(id, Math.max(0, score - by))

        return Math.max(0, score - by)
    }

    getRatingTable = () => {
        return this.ids.map((id) => this.entities.get(id))
    }

    getRating = (id) => {
        return this.entities.get(id)
    }

    saveToFile = () => {
        const data = {
            ids: this.ids,
            entities: Array.from(this.entities.entries()), // Преобразуем Map в массив
        };

        fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    };

    loadFromFile = () => {
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify({
                ids: [],
                entities: []
            }));

            return;
        }

        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        this.ids = data.ids;
        this.entities = new Map(data.entities);
        this.ids.sort((a, b) => this.entities.get(b).score - this.entities.get(a).score)
    };
}

const rating = new Rating()

const saveChatsHandler = async (msg, next) => {
    if (messageCounter >= 10) {
        const chats = loadChats();
        const chatId = msg.chat.id;

        if (!chats.includes(chatId)) {
            saveChats(chats.concat(chatId))
        }
    }

    next(msg)
}

const incMessageCounter = async (msg, next) => {
    messageCounter += 1;

    next(msg)
}

const checkIfUserPlaying = async (msg, next) => {
    const userId = msg.from.id;

    if (players.has(userId)) {
        next(msg)
    }
}

const checkIfOneWord = async (msg, next) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const fromUser = msg.from.username ? `@${msg.from.username}` : 'неизвестный пидорг';
    const text = msg.text?.toLowerCase(); // Приводим текст к нижнему регистру
    if (!text) return;

    const words = text.split(/\s+/);
    const regexp = createRegExp(TRIGGER_WORDS.map(({word}) => word));

    const stickers = loadStickers()

    if (words.length === 1 && regexp.test(words[0])) {
        await bot.sendMessage(chatId, `${fromUser} Ты получаешь 1 очко`)
        await bot.sendMessage(chatId, `Всего слов осталось ${TRIGGER_WORDS.length - 1}`)
        await bot.sendSticker(chatId, getRandomElement(stickers));

        hintedWord = null;
        const trigger = TRIGGER_WORDS.find(({word}) => word !== words[0]);
        TRIGGER_WORDS = TRIGGER_WORDS.filter(({word}) => word !== words[0]);

        rating.increaseScore(userId, trigger.rarity);
        rating.saveToFile();
        spamers.set(userId, 0)
    } else if (words.length === 1 && !regexp.test(words[0])) {
        const prevCount = spamers.get(userId) || 0;

        spamers.set(userId, prevCount + 1)
    }

    next(msg)
}

const checkIfUserSpammed = async (msg, next) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const fromUser = msg.from.username ? `@${msg.from.username}` : 'неизвестный пидрила';

    const spamCount = spamers.get(userId) || 0;

    if (spamCount >= 30) {
        const penaltyScore = getRandomNumber(1, 3);

        rating.decreaseScore(userId, penaltyScore);

        await bot.sendMessage(chatId, `${fromUser} Ебать ты газлайтер! Короче, ты меня заебал, поэтому я тебе вычту твои шлюшьи сбережения: <b>-${penaltyScore}</b> очков Гриффиндору`, {parse_mode: 'HTML'})
        spamers.set(userId, 0)
    }

    next(msg)

}

const checkIfWordInSentence = async (msg, next) => {
    const chatId = msg.chat.id;

    const fromUser = msg.from.username ? `@${msg.from.username}` : 'неизвестный пидрила';
    const text = msg.text?.toLowerCase(); // Приводим текст к нижнему регистру
    if (!text) return;

    const regexp = createRegExp(TRIGGER_WORDS.map(({word}) => word));
    const words = text.split(/\s+/);
    if (regexp.test(text) && words.length > 1) {
        await bot.sendMessage(chatId, `${fromUser} Твоя жопа близка к истине! Ковыряйся дальше`)
    }

    next(msg)
}

const checkIfNoWordsHasLeft = async (msg, next) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const fromUser = msg.from.username ? `@${msg.from.username}` : 'неизвестный пидрила';

    if (TRIGGER_WORDS.length === 0) {
        await bot.sendMessage(chatId, `${fromUser} Все слова были найдены. А для твоего очка у меня особый приз. 10 очков гриффиндору!`)

        TRIGGER_WORDS = setWordRarity(getNewWords(loadDict()));
        rating.increaseScore(userId, 10)

        rating.saveToFile();

        process.exit();
    }

    next(msg)
}

const saveResults = async (msg, next) => {
    if (messageCounter >= 10) {
        rating.saveToFile()

        messageCounter = 0
    }

    next(msg)
}

const logger = async (msg, next) => {
    console.log(msg)

    next(msg)
}

const loadEmojis = () => {
    if (!fs.existsSync(EMOJI_FILE)) {
        // Если файла нет, создаём пустой массив
        fs.writeFileSync(EMOJI_FILE, JSON.stringify([]));
        return [];
    }

    const data = fs.readFileSync(EMOJI_FILE, 'utf-8');
    return JSON.parse(data);
}

const emojis = loadEmojis();

const saveLetters = async (msg, next) => {
    const emoji = loadEmoji();

    const newEmoji = transformMessage(msg);

    emoji.push(newEmoji)

    fs.writeFileSync(EMOJI_FILE, JSON.stringify(emoji, null, 2));

    next(msg)
}

const mainChain = createChainAdapter(checkIfUserPlaying, incMessageCounter, checkIfOneWord, checkIfUserSpammed, checkIfWordInSentence, checkIfNoWordsHasLeft, saveChatsHandler, saveResults);
const testChain = createChainAdapter(logger);

const messageScenarios = mainChain

const init = () => {
    const chats = loadChats();

    chats.forEach(chat => {
        bot.sendMessage(chat, 'АЛЛАХ АКБАР, СУЧЕЧКИ. Я ТУТ. Я ЖИВ. НАЖИМАЙТЕ /play_game');
    })
}

init();

// Реакция на сообщения
bot.on('message', messageScenarios);

bot.onText(/^\/get_rating(?:@bombinator_bot)?$/, (msg) => {
    const chatId = msg.chat.id; // ID чата, откуда пришло сообщение
    const userId = msg.from.id; // ID пользователя, который отправил сообщение
    const username = msg.from.username ? `@${msg.from.username}` : 'неизвестный пидрила';

    const score = rating.getRating(userId).score || 0

    // Отправляем ответ
    bot.sendMessage(
        chatId,
        `${username}, твой рейтинг: ${score} порванных жоп`
    );
});

const getScoreSymbol = (i) => ['👑', '👌', '☠️'].at(i) || ''

bot.onText(/^\/get_rating_table(?:@bombinator_bot)?$/, (msg) => {
    const chatId = msg.chat.id; // ID чата, откуда пришло сообщение
    const userId = msg.from.id; // ID пользователя, который отправил сообщение

    const ratingTable = rating.getRatingTable(userId).slice(0, 9)
        .map(({
           score,
           username
       }, i) => `${i + 1}. ${getScoreSymbol(i)} ${username} : ${score}`).join('\n')

    bot.sendMessage(
        chatId,
        `Почетная доска шлюх: \n ${ratingTable}`
    );
});

bot.onText(/\/get_word_hint/, async (msg) => {
    const chatId = msg.chat.id; // ID чата, откуда пришло сообщение
    const userId = msg.from.id; // ID пользователя, который отправил сообщение
    const username = msg.from.username ? `@${msg.from.username}` : 'неизвестный пидрила';

    if (!players.has(userId)) {
        bot.sendMessage(
            chatId,
            `${username} Ты кого тут пытаешься наебать, петуш опущенный? /play_bombinator вначале набери. Ишак`
        );

        return
    }

    const score = rating.getRating(userId).score || 0;

    if (score <= 0) {
        bot.sendMessage(
            chatId,
            `${username} нищий планктон, больше отгадывай. Охуел блять. Подсказку ему. Ага. Конечно. Хуй тебе`
        );
    } else {
        const newScore = rating.decreaseScore(userId, 1);
        const triggerWord = hintedWord ?? getRandomElement(TRIGGER_WORDS);

        if (!hintedWord) {
            await bot.sendMessage(
                chatId,
                `${username} у тебя осталось ${newScore} разорванных жоп. \n На тебе подсказку: <b>${triggerWord.hint}</b>`,
                {parse_mode: 'HTML'}
            );
        }

        // Создаем или обновляем маску
        hintedWord = {
            ...triggerWord,
            mask: maskWord(triggerWord.word, hintedWord?.mask)
        };

        const emoji = getCustomEmojiObjects(hintedWord.mask, emojis);

        await bot.sendMessage(chatId, emoji, {parse_mode: 'HTML'});
    }
});


bot.onText(/\/change_username (.+)/, (msg, match) => {
    const chatId = msg.chat.id; // ID чата
    const userId = msg.from.id; // ID пользователя
    const newUsername = match[1].trim(); // Новый username из команды

    // Проверяем, что аргумент не пустой
    if (!newUsername || newUsername.length === 0) {
        bot.sendMessage(
            chatId,
            'Скуф обоссаный, я тут в шутки с тобой играть не собираюсь. Я алгоритм. Откуда я, блять, знаю как тебя назвать? Укажи новый никнейм после команды /change_username \n <b>пидор</b>',
            {parse_mode: 'HTML'}
        );
        return;
    }

    rating.updateUser(userId, {username: newUsername});
    rating.saveToFile();
    bot.sendMessage(chatId, `Ваше имя успешно обновлено на: ${newUsername}`);
});

bot.onText(/\/change_username$/, (msg) => {
    const chatId = msg.chat.id;

    bot.sendMessage(
        chatId,
        'Скуф обоссаный, я тут в шутки с тобой играть не собираюсь. Я алгоритм. Откуда я, блять, знаю как тебя назвать? Укажи новый никнейм после команды /change_username \n <b>пидор</b>',
        {parse_mode: 'HTML'}
    );
});

const catsHitStickerId = 'CAACAgIAAxkBAAOyZ0ymmNJGYoBnT0HcV_v3PhZE5HwAAoNkAAJ3vdhJqjQqNlKH6L82BA'
bot.onText(/\/play_game$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username ? `@${msg.from.username}` : 'неизвестный пидрила';

    if (players.has(userId)) {
        await bot.sendMessage(
            chatId,
            `${username} ой ты бля, любитель double penetration. Иди отседова, или ща хуйну тебе очки. Ты и так в игре дятел. Не беси меня`,
        );

        await bot.sendSticker(
            chatId,
            catsHitStickerId
        );

        return;
    }

    players.add(userId);

    if (rating.has(userId)) {
        bot.sendMessage(
            chatId,
            `${username} о, блять, блудный сын вернулся. Пиздец. Ну здрасьте 👋. На этот раз отличишься умом?`,
        );

        return
    }

    bot.sendMessage(
        chatId,
        `${username} добро пожаловать в ад, педик. Правила читай тут /how_to_play \nТак и быть с барской руки отсыплю тебе 10 очков. Не кончи от счастья`,
    );

    rating.addNewUser(userId, {username})
    rating.setNewScore(userId, 10);
    rating.saveToFile();
});

const catInShocked = 'CAACAgIAAxkBAAOzZ0ynIcFkbDHPZrA6EgdinoKmXekAAm1dAALsrfBJkadE3o_UugABNgQ'
bot.onText(/\/exit_game$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username ? `@${msg.from.username}` : 'неизвестный пидрила';

    if (players.has(userId)) {
        await bot.sendMessage(
            chatId,
            `${username} очумелые, блять, ручки. Ты не играл, чтобы выходить. Ты не умный, да? `,
        );

        await bot.sendSticker(
            chatId,
            catInShocked
        );

        return;
    }

    await bot.sendMessage(
        chatId,
        `${username} ну и пиздуй, ну и пожалуйста. Чао какао! Адьос! Аривидерчи! `,
        {parse_mode: 'HTML'}
    );

    players.delete(userId)
});


const reactions = loadReactions();
let temperanceTrying = 0;
bot.onText(/\/how_to_play$/, (msg) => {
    const chatId = msg.chat.id;

    if (temperanceTrying === 0) {
        bot.sendMessage(
            chatId,
            `В этой игре каждый раунд я загадываю 10 слов. Твоя задача — угадывать их. Каждое отгаданное слово приносит тебе 1 очко, но есть особые слова, которые дают 2 или даже 3 очка. У тебя есть 20 попыток на один раунд, и будь аккуратен, потому что я могу отобрать от 1 до 3 очков, если меня что-то разозлит. Чтобы получить подсказку, напиши /get_word_hint. Иногда я буду прятать слова в предложениях и подскажу, где искать. Хочешь сменить имя? Используй /change_username. Начать игру можно командой /play_game, а чтобы выйти — /exit_game. И да, каждое отгаданное слово будет приятно тебе, будто оно создано специально для твоих фантазий. Постарайся не раздражать меня спамом, иначе я превращусь в ту ещё недовольную тварь. Всё просто. Если готов, напиши /play_game, и поехали!`,
        );
    } else {
        const response = reactions.find(({ level }) => level === temperanceTrying).response || '';

        response && bot.sendMessage(
            chatId,
            response
        );
    }

    if (temperanceTrying <= 100) {
        temperanceTrying += 1
    } else {
        temperanceTrying = 0
    }
});

console.log('Бот запущен и слушает сообщения...');