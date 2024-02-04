const express = require('express');
const { Client } = require('pg');
const http = require('http');
const socketIO = require('socket.io');
const { log } = require('console');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const client = new Client({
  user: 'postgres',
  host: 'localhost',
  database: 'server',
  password: '123456',
  port: 5432,
});
client
  .connect()
  .then(() => console.log('Connected to PostgreSQL'))
  .catch((error) => console.error('Error connecting to PostgreSQL:', error));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/client/client.html');
});

io.on('connection', (socket) => {
  console.log('A user connected', socket.id);

  socket.on('chat list', async (data) => {
    try {
      saveChatList(data);
    } catch (error) {
      console.error('Error executing query:', error.message);
    }
  });

  socket.on('sendMessage', async (data) => {
    if ('message' in data) {
      saveMessageToDatabase(data);
      updateLastMsg(data.room_id, data.message, data.send_time);
    }

    try {
      const messages = await getMessagesByRoomId(data.room_id, 10);
      io.emit('allMessages', messages);
      io.emit('');
    } catch (error) {
      console.error('Error handling getMessages:', error);
    }
  });

  socket.on('newPost', async (data) => {
    if (data !== undefined) {
      savePostToDatabase(data);
    }
    try {
      const posts = await getNewPost(10);
      io.emit('allPosts', posts);
    } catch (error) {
      console.error('Error save post to database', error);
    }
  });

  socket.on('getChatList', async (myid, eventId) => {
    try {
      const getChatListQuery = `
      SELECT chatlist.*, info_user.avt_url
      FROM chatlist
      INNER JOIN info_user ON CAST(chatlist.my_id AS VARCHAR) = info_user.user_id OR CAST(chatlist.other_id AS VARCHAR) = info_user.user_id
   	  WHERE $1 IN (my_id)
	    AND CAST(info_user.user_id AS INTEGER) <> $1
      ORDER BY updated_at DESC`;
      const result = await client.query(getChatListQuery, [myid]);

      io.emit('datachatList', { data: result.rows, eventId });
    } catch (error) {
      console.error('Error fetching chat list:', error.message);
    }
  });

  socket.on('getPosts', async (limit) => {
    const posts = await getNewPost(limit);
    io.emit('allPosts', posts);
  });

  socket.on('getMessages', async (room_id, limit) => {
    try {
      const messages = await getMessagesByRoomId(room_id, limit);

      io.emit('allMessages', messages);
    } catch (error) {
      console.error('Error handling getMessages:', error);
    }
  });

  socket.on('getPostFromUserId', async (room_id, limit) => {
    const postuserId = await getPostFromUserId(room_id, limit);
    io.emit('PostForUser', postuserId);
  });

  socket.on('getAvt', async (user_id) => {
    let avatar = await getAvt(user_id);
    io.emit('AvtUser', avatar);
  });
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

async function saveChatList(data) {
  try {
    const {
      roomId,
      lastMsg,
      myName,
      myEmail,
      myId,
      nameOther,
      emailOther,
      idOther,
    } = data;

    const checkChatRoomQuery =
      'SELECT * FROM chatlist WHERE (my_id = $1 AND other_id = $2) OR (my_id = $2 AND other_id = $1)';
    const resultOther = await client.query(checkChatRoomQuery, [myId, idOther]);

    if (resultOther.rows.length === 0) {
      // Nếu phòng chat chưa tồn tại, thêm mới vào PostgreSQL
      const insertChatRoomQuery = `
            INSERT INTO chatlist (room_id,last_msg,my_name,my_email,my_id,name_other,email_other,other_id)
            VALUES ($1, $2, $3, $4, $5, $6,$7,$8);
          `;
      await client.query(insertChatRoomQuery, [
        roomId,
        lastMsg,
        myName,
        myEmail,
        myId,
        nameOther,
        emailOther,
        idOther,
      ]);
      await client.query(insertChatRoomQuery, [
        roomId,
        lastMsg,
        nameOther,
        emailOther,
        idOther,
        myName,
        myEmail,
        myId,
      ]);
    }
  } catch (error) {
    console.error('Error  saving chat list to database: ', error);
  }
}

async function saveMessageToDatabase(data) {
  try {
    const { room_id, message, sender_id, receiver_id, send_time, msg_type } =
      data;

    await client.query(
      'INSERT INTO messages (room_id, message, sender_id, receiver_id, send_time, message_type,voice_duration) VALUES ($1, $2, $3, $4, $5, $6,$7)',
      [room_id, message, sender_id, receiver_id, send_time, msg_type, 'null']
    );
  } catch (error) {
    console.error('Error saving message to PostgreSQL:', error);
  }
}

async function savePostToDatabase(data) {
  try {
    const {
      post_id,
      text_post,
      media_post,
      user_name,
      user_id,
      post_time,
      post_type,
    } = data;

    await client.query(
      'INSERT INTO posts (post_id, text_post, media_post, user_name,user_id, post_time, post_type) VALUES ($1, $2, $3, $4, $5, $6,$7)',
      [post_id, text_post, media_post, user_name, user_id, post_time, post_type]
    );
  } catch (error) {
    console.error('Error saving post to PostgreSQL:', error);
  }
}

async function getMessagesByRoomId(room_id, limit) {
  try {
    const getLatestMessagesQuery = `
      SELECT * 
      FROM messages 
      WHERE room_id = $1 
      ORDER BY send_time DESC
      LIMIT $2
    `;

    const result = await client.query(getLatestMessagesQuery, [room_id, limit]);
    return result.rows;
  } catch (error) {
    console.error('Error getting latest messages from PostgreSQL:', error);
    return [];
  }
}

async function getNewPost(limit) {
  try {
    const getLatestPostsQuery = `
      SELECT * 
      FROM posts 
      ORDER BY id DESC
      LIMIT $1
    `;

    const result = await client.query(getLatestPostsQuery, [limit]);

    return result.rows;
  } catch (error) {
    console.error('Error getting latest posts from PostgreSQL:', error);
    return [];
  }
}

async function getPostFromUserId(user_id, limit) {
  try {
    let queryString = `
    SELECT * 
    FROM posts
    WHERE user_id=$1 
    ORDER BY id DESC
    LIMIT $2`;

    const result = await client.query(queryString, [user_id, limit]);
    return result.rows;
  } catch (error) {
    console.error('Error get Post From User Id', error);
    return [];
  }
}

async function getAvt(user_id) {
  try {
    let query = `
    SELECT *
    FROM public.info_user
    WHERE user_id=$1`;

    const result = await client.query(query, [user_id]);
    return result.rows;
  } catch (error) {
    console.error('Error get  Avatar from User ID: ', error);
    return [];
  }
}

async function updateLastMsg(room_id, last_msg, updated_at) {
  try {
    let query = `
    UPDATE chatlist
    SET last_msg=$1,updated_at=$2
    WHERE room_id=$3`;
    const result = await client.query(query, [last_msg, updated_at, room_id]);
    return result.rows;
  } catch (error) {
    console.error('Error update  last message in room : ', error);
  }
}
