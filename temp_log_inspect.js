const { MongoClient } = require('mongodb');
const uri = "mongodb://deynyelicawalo_db_user:h9sM5NYNeO0R96vw@ac-bbriiqg-shard-00-00.yeogezu.mongodb.net:27017,ac-bbriiqg-shard-00-01.yeogezu.mongodb.net:27017,ac-bbriiqg-shard-00-02.yeogezu.mongodb.net:27017/?ssl=true&replicaSet=atlas-uamnqz-shard-0&authSource=admin&appName=Cluster0";
(async () => {
  try {
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db('psa_queue_system');
    const cols = await db.listCollections().toArray();
    console.log(JSON.stringify(cols.map(c => c.name), null, 2));
    await client.close();
  } catch (err) {
    console.error('ERROR', err);
    process.exit(1);
  }
})();
