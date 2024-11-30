const createChainAdapter = (...chains) => {
    return (initialArg) => {
        const executeChain = (index, arg) => {
            if (index >= chains.length) return; // Если цепочка закончилась

            const currentFunction = chains[index];
            currentFunction(arg, (nextArg) => executeChain(index + 1, nextArg));
        };

        executeChain(0, initialArg); // Запускаем цепочку с начальным аргументом
    };
};

module.exports = {
    createChainAdapter
}

a = next => b => next(b)