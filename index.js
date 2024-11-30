const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { createChainAdapter } = require('./utils/chainAdapter')

// Вставьте ваш токен от BotFather
const TOKEN = '7555537046:AAFSBPiEs0416TFVMS9GE02-Dt9CXJfL0sA';
const bot = new TelegramBot(TOKEN, { polling: {
        params: {
            offset: 0 // Берём только новые сообщения
        }
    } });


const STICKERS_FILE = './stickers.json';
const DICT_FILE = './dictionary.json';
const CHATS_FILE = './data/chats.json';

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

function maskWord(word) {
    if (typeof word !== 'string' || word.length === 0) {
        throw new Error('Передайте непустую строку');
    }
    return word[0] + '*'.repeat(word.length - 1);
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

const loadChats = () => {
    if (!fs.existsSync(CHATS_FILE)) {
        // Если файла нет, создаём пустой массив
        fs.writeFileSync(CHATS_FILE, JSON.stringify([]));
        return [];
    }

    const data = fs.readFileSync(CHATS_FILE, 'utf-8');
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

let TRIGGER_WORDS = getNewWords(loadDict());

let messageCounter = 0

const spamers = new Map();

class Rating {
    ids = []
    entities = new Map()
    filePath = path.resolve(__dirname, 'data/rating.json');

    constructor() {
       this.loadFromFile()
    }


    addNewUser = (id, { username = 'неизвестный пидрила' }) => {
        if (this.entities.has(id)) {
            return
        }

        this.entities.set(id, { score: 0, username })
        this.ids.push(id)
    }

    updateUser = (id, newField) => {
        if (!this.entities.has(id)) {
            this.addNewUser(id, newField)

            return
        }

        const prevData = this.getRating(id);

        this.entities.set(id, {...prevData, ...newField })
        this.ids.sort((a, b) => this.entities.get(b).score - this.entities.get(a).score)
    }

    setNewScore = (id, score) => {
        const prevData = this.entities.get(id);

        this.entities.set(id, {...prevData, score })

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
            console.warn(`Файл ${this.filePath} не найден, загрузка пропущена.`);
            return;
        }

        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        this.ids = data.ids;
        this.entities = new Map(data.entities);
        this.ids.sort((a, b) => this.entities.get(b).score - this.entities.get(a).score)
    };
}

const rating =  new Rating()

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

const registerNewUser = async (msg, next) => {
    const userId = msg.from.id;
    rating.addNewUser(userId, msg.from);

    next(msg)
}

const checkIfOneWord = async (msg, next) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const fromUser = msg.from.username || 'неизвестный пидрила';
    const text = msg.text?.toLowerCase(); // Приводим текст к нижнему регистру
    if (!text) return;

    const words = text.split(/\s+/);
    const regexp = createRegExp(TRIGGER_WORDS.map(({ word }) => word));

    const stickers = loadStickers()

    if (words.length === 1 && regexp.test(words[0])) {
        await bot.sendMessage(chatId, `@${fromUser} Ты получаешь 1 взорванное очко`)
        await bot.sendMessage(chatId, `Всего слов осталось ${TRIGGER_WORDS.length}`)
        await bot.sendSticker(chatId, getRandomElement(stickers));

        rating.increaseScore(userId, 1)
        rating.saveToFile();

        TRIGGER_WORDS = TRIGGER_WORDS.filter(({word}) => word !== words[0]);
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

    const fromUser = msg.from.username || 'неизвестный пидрила';

    const spamCount = spamers.get(userId) || 0;

    if (spamCount >= 20) {
        const penaltyScore = getRandomNumber(1, 5);

        rating.decreaseScore(userId, penaltyScore);

        await bot.sendMessage(chatId, `@${fromUser} Ебать ты газлайтер! Короче, ты меня заебал, поэтому я тебе вьебу... <b>${penaltyScore}</b> очков Гриффиндору`, { parse_mode: 'HTML' })
        spamers.set(userId, 0)
    }

    next(msg)

}

const checkIfWordInSentence = async (msg, next) => {
    const chatId = msg.chat.id;

    const fromUser = msg.from.username || 'неизвестный пидрила';
    const text = msg.text?.toLowerCase(); // Приводим текст к нижнему регистру
    if (!text) return;

    const regexp = createRegExp(TRIGGER_WORDS.map(({ word }) => word));
    const words = text.split(/\s+/);
    if (regexp.test(text) && words.length > 1) {
        await bot.sendMessage(chatId, `@${fromUser} Твоя жопа близка к истине! Ковыряйся дальше`)
    }

    next(msg)
}

const checkIfNoWordsHasLeft = async (msg, next) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (TRIGGER_WORDS.length === 0) {
        await bot.sendMessage(chatId, `@${fromUser} Все слова были найдены. А для твоего очка у меня особый приз. 10 очков гриффиндору!`)

        TRIGGER_WORDS = getNewWords(loadDict());
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

const messageScenarios = createChainAdapter(incMessageCounter, registerNewUser, checkIfOneWord, checkIfUserSpammed, checkIfWordInSentence, checkIfNoWordsHasLeft, saveChatsHandler, saveResults);

const init = () => {
    const chats = loadChats();

    chats.forEach(chat => {
        bot.sendMessage(chat, 'АЛЛАХ АКБАР, СУЧЕЧКИ. Я ТУТ');
    })
}

init();

// Реакция на сообщения
bot.on('message',  messageScenarios);

bot.onText(/^\/get_rating(?:@bombinator_bot)?$/, (msg) => {
    const chatId = msg.chat.id; // ID чата, откуда пришло сообщение
    const userId = msg.from.id; // ID пользователя, который отправил сообщение
    const username = msg.from.username || 'неизвестный пидрила';

    const score = rating.getRating(userId).score || 0

    // Отправляем ответ
    bot.sendMessage(
        chatId,
        `@${username}, твой рейтинг: ${score} порванных жоп`
    );
});

const getScoreSymbol = (i) => ['👑', '👌', '☠️'].at(i) || ''

bot.onText(/^\/get_rating_table(?:@bombinator_bot)?$/, (msg) => {
    const chatId = msg.chat.id; // ID чата, откуда пришло сообщение
    const userId = msg.from.id; // ID пользователя, который отправил сообщение

    const ratingTable = rating.getRatingTable(userId).slice(0, 9).map(({ score, username }, i) => `${i + 1}. ${getScoreSymbol(i)} ${username} : ${score}`).join('\n')

    bot.sendMessage(
        chatId,
        `Почетная доска шлюх: \n ${ratingTable}`
    );
});

bot.onText(/\/get_word_mask/, (msg) => {
    const chatId = msg.chat.id; // ID чата, откуда пришло сообщение
    const userId = msg.from.id; // ID пользователя, который отправил сообщение
    const username = msg.from.username || 'неизвестный пидрила';

    const score = rating.getRating(userId).score || 0;

    if (score <= 0) {
        bot.sendMessage(
            chatId,
            `@${username} нищий планктон, больше отгадывай. Охуел блять. Подсказку ему. Ага. Конечно. Хуй тебе`
        );
    } else {
        const randomWord = getRandomElement(TRIGGER_WORDS);
        const newScore = rating.decreaseScore(userId, 1);

        bot.sendMessage(
            chatId,
            `@${username} у тебя осталось ${newScore} разорванных жоп. \n На тебе подсказку: ${maskWord(randomWord.word)}`
        );

    }
});

bot.onText(/\/get_word_hint/, (msg) => {
    const chatId = msg.chat.id; // ID чата, откуда пришло сообщение
    const userId = msg.from.id; // ID пользователя, который отправил сообщение
    const username = msg.from.username || 'неизвестный пидрила';

    const score = rating.getRating(userId).score || 0;

    if (score <= 0) {
        bot.sendMessage(
            chatId,
            `@${username} нищий планктон, больше отгадывай. Охуел блять. Подсказку ему. Ага. Конечно. Хуй тебе`
        );
    } else {
        const randomWord = getRandomElement(TRIGGER_WORDS);
        const newScore = rating.decreaseScore(userId, 2);

        bot.sendMessage(
            chatId,
            `@${username} у тебя осталось ${newScore} разорванных жоп. \n На тебе подсказку:  <b>${randomWord.hint}</b>`, { parse_mode: 'HTML' }
        );

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
            { parse_mode: 'HTML' }
        );
        return;
    }

    rating.updateUser(userId, { username: newUsername });
    rating.saveToFile();
    bot.sendMessage(chatId, `Ваше имя успешно обновлено на: ${newUsername}`);
});

bot.onText(/\/change_username$/, (msg) => {
    const chatId = msg.chat.id;

    bot.sendMessage(
        chatId,
        'Скуф обоссаный, я тут в шутки с тобой играть не собираюсь. Я алгоритм. Откуда я, блять, знаю как тебя назвать? Укажи новый никнейм после команды /change_username \n <b>пидор</b>',
        { parse_mode: 'HTML' }
    );
});

console.log('Бот запущен и слушает сообщения...');