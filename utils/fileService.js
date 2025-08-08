
const { Pool } = require('pg');
const { LargeObjectManager } = require('pg-large-object');
const stream = require('stream');

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Function to upload a file to PostgreSQL Large Object
async function uploadFile(file) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const man = new LargeObjectManager({ pg: client });
    const [oid, loStream] = await man.createAndWritableStreamAsync();

    const bufferStream = new stream.PassThrough();
    bufferStream.end(file.buffer);
    
    await new Promise((resolve, reject) => {
      bufferStream.pipe(loStream);
      loStream.on('finish', resolve);
      loStream.on('error', reject);
    });

    await client.query('COMMIT');
    return oid;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Function to download a file from PostgreSQL Large Object
async function downloadFile(oid) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const man = new LargeObjectManager({ pg: client });
    const [size, loStream] = await man.openAndReadableStreamAsync(oid);
    
    const chunks = [];
    for await (const chunk of loStream) {
      chunks.push(chunk);
    }
    
    await client.query('COMMIT');
    return Buffer.concat(chunks);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  uploadFile,
  downloadFile
};
