const { MongoClient } = require('mongodb');

// Your connection string
const MONGO_URI ='mongodb+srv://entertainmenttiktok42_db_user:t4tWnLuO0Vl839uI@cluster0.0jjkwj5.mongodb.net/?appName=Cluster0'

async function clearDatabase() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db('queuectl');

    console.log('Connecting to database...');

    const collections = ['jobs', 'configs']; // Add any collections you want to clear

    for (const collection of collections) {
      const result = await db.collection(collection).deleteMany({});
      console.log(`Cleared ${result.deletedCount} documents from '${collection}'`);
    }

    console.log('Database cleared successfully.');

  } catch (err) {
    console.error('Error clearing database:', err.message);
  } finally {
    await client.close();
  }
}

clearDatabase();