const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL + '?sslmode=require',
 
});

pool
  .connect()
  .then(() => console.log('Connected to PostgreSQL'))
  .catch((error) => console.error('Error connecting to PostgreSQL:', error));

module.exports = pool;
