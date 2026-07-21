const databaseName = "native-gb";
const databaseVersion = 1;
const storeName = "game-data";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(storeName))
        request.result.createObjectStore(storeName);
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function key(gameId, romSha1, name) {
  return `${gameId}/${romSha1}/${name}`;
}

async function request(method, gameId, romSha1, name, value) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, method === "get" ? "readonly" : "readwrite");
    const store = transaction.objectStore(storeName);
    const operation = method === "get" ? store.get(key(gameId, romSha1, name))
                                       : store.put(value, key(gameId, romSha1, name));
    operation.addEventListener("success", () => resolve(operation.result));
    operation.addEventListener("error", () => reject(operation.error));
    transaction.addEventListener("complete", () => database.close());
  });
}

export function readGameData(gameId, romSha1, name) {
  return request("get", gameId, romSha1, name);
}

export function writeGameData(gameId, romSha1, name, value) {
  return request("put", gameId, romSha1, name, value);
}
