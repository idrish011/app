
const { Pool } = require('pg');
const { LargeObjectManager } = require('pg-large-object');
const stream = require('stream');

const db = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_5jDmyEF4cPul@ep-holy-lab-a1gq3lv4-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
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
