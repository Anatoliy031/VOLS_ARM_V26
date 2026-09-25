#!/bin/sh
# Полный прогон перед отправкой изменений в репозиторий.
# Порядок от быстрого к медленному: синтаксис → ядро → шаблон → страницы.
set -e
cd "$(dirname "$0")/.."
echo "════ синтаксис"
node tools/check-syntax.js
echo "════ ядро"
node tools/test-core.js
echo "════ шаблон исходных данных"
node tools/test-template.js
echo "════ раздел «Выезды»"
node tools/test-vyezdy.js
echo "════ страницы в браузерном окружении"
node tools/test-pages.js 2>&1 | grep -v "Not implemented"
echo "════ всё пройдено"
