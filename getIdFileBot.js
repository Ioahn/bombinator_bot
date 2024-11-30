const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const TOKEN = '7814762834:AAEKZKLcFn0yRQG13Drep77qmZT04gbfG8g';
const bot = new TelegramBot(TOKEN, { polling: {
        params: {
            offset: 0 // Берём только новые сообщения
        }
    } });

const STICKERS_FILE = './stickers.json';

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

const saveStickers = (stickers) => {
    fs.writeFileSync(STICKERS_FILE, JSON.stringify(stickers, null, 2));
};

let stickers = loadStickers();

bot.on('message', (msg) => {
    if (msg.sticker) {
        const stickerId = msg.sticker.file_id;

        // Проверяем, есть ли ID уже в массиве
        if (!stickers.includes(stickerId)) {
            stickers.push(stickerId); // Добавляем новый ID
            saveStickers(stickers);  // Сохраняем в файл
            bot.sendMessage(msg.chat.id, `Стикер сохранён! Сейчас в базе ${stickers.length} стикеров.`);
        } else {
            bot.sendMessage(msg.chat.id, 'Этот стикер уже есть в базе.');
        }
    }
});

console.log('Бот запущен и слушает сообщения...');
