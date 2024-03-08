const express = require('express');
const { Client } = require('pg');
const http = require('http');
const socketIO = require('socket.io');
const { log } = require('console');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const client = new Client({
  user: 'default',
  host: 'ep-plain-pine-a1ag6s7p-pooler.ap-southeast-1.aws.neon.tech',
  database: 'verceldb',
  password: '0KNlfjJWg4Bb',
  port: 5432,
  ssl: {
    rejectUnauthorized: false,
  },
});
client
  .connect()
  .then(() => console.log('Connected to PostgreSQL'))
  .catch((error) => console.error('Error connecting to PostgreSQL:', error));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/client/client.html');
});

io.on('connection', (socket) => {
  socket.on('connection', (data) => {
    const { user_id } = data;
    onlineUser(user_id);
    console.log('User: ', user_id, 'connected');
  });

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
    } catch (error) {
      console.error('Error handling getMessages:', error);
    }
  });

  socket.on('retrieveMessage', async (data) => {
    try {
      const messages = await retrieveMessage(data);
      io.emit('allMessages', messages);
    } catch (error) {
      console.error('Error handling getMessages:', error);
    }
  });

  socket.on('editMessage', async (id, message) => {
    try {
      const messages = await editMessage(id, message);
      io.emit('allMessages', messages);
    } catch (error) {
      console.error('Error edit message: ', error);
    }
  });

  socket.on('getChatList', async (myid, eventId) => {
    try {
      const getChatListQuery = `
      SELECT chatlist.*, info_user.*
      FROM chatlist
      INNER JOIN info_user ON CAST(chatlist.my_user_id AS INTEGER) = info_user.user_id OR CAST(chatlist.other_user_id AS INTEGER) = info_user.user_id
   	  WHERE $1 IN (my_user_id)
	    AND CAST (info_user.user_id AS INTEGER)  <> $1
      ORDER BY updated_at DESC`;
      const result = await client.query(getChatListQuery, [myid]);

      io.emit('datachatList', { data: result.rows, eventId });
    } catch (error) {
      console.error('Error fetching chat list:', error.message);
    }
  });

  socket.on('getChatListFromId', async (myid, otherid, eventId) => {
    try {
      const getChatListQuery = `
      SELECT chatlist.*, info_user.avt_url
      FROM chatlist
      INNER JOIN info_user ON CAST(chatlist.my_user_id AS INTEGER) = info_user.user_id OR CAST(chatlist.other_user_id AS INTEGER) = info_user.user_id
   	  WHERE( my_user_id= $1 and other_user_id=$2) 
	    AND CAST(info_user.user_id AS INTEGER) <> $1
      ORDER BY updated_at DESC`;
      const result = await client.query(getChatListQuery, [myid, otherid]);
      io.emit('chatlistfromid', { data: result.rows, eventId });
    } catch (error) {
      console.error('Error fetching chat list:', error.message);
    }
  });

  socket.on('deleteChatList', async (room_id) => {
    try {
      let query = `
      DELETE FROM chatlist
      WHERE room_id=$1`;
      const result = await client.query(query, [room_id]);
      return result.rows;
    } catch (error) {
      console.error('Error delete chat list');
    }
  });

  socket.on('deletePost', async (post_id) => {
    try {
      const posts = await deletePost(post_id);
      io.emit('PostForUser', posts);
    } catch (error) {
      console.error('Error handling getMessages:', error);
    }
  });

  socket.on('getMessages', async (room_id, limit) => {
    try {
      const messages = await getMessagesByRoomId(room_id, limit);

      io.emit('allMessages', messages);
    } catch (error) {
      console.error('Error handling getMessages:', error);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected');
  });

  socket.on('user_disconnect', (data) => {
    const { user_id } = data;
    offUser(user_id);
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
      'SELECT * FROM chatlist WHERE (my_user_id = $1 AND other_user_id = $2) OR (my_user_id = $2 AND other_user_id = $1)';
    const resultOther = await client.query(checkChatRoomQuery, [myId, idOther]);

    if (resultOther.rows.length === 0) {
      // Nếu phòng chat chưa tồn tại, thêm mới vào PostgreSQL
      const insertChatRoomQuery = `
            INSERT INTO chatlist (room_id,last_msg,my_name,my_email,my_user_id,name_other,email_other,other_user_id,updated_at)
            VALUES ($1, $2, $3, $4, $5, $6,$7,$8, NOW());
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

async function retrieveMessage(id) {
  try {
    let query = `
    UPDATE messages
    SET message_type='retrieve'
    WHERE id=$1`;
    const result = await client.query(query, [id]);
    return result.rows;
  } catch (error) {
    console.error('Error update message : ', error);
  }
}

async function editMessage(id, message) {
  try {
    let query = `
    UPDATE messages
    SET message_type='edittext',message=$1
    WHERE id=$2`;
    const result = await client.query(query, [message, id]);
    return result.rows;
  } catch (error) {
    console.error('Error update message : ', error);
  }
}

async function onlineUser(id) {
  try {
    let query = `
    UPDATE info_user
    SET status='true'
    WHERE user_id=$1`;
    const result = await client.query(query, [id]);
    return result.rows;
  } catch (error) {
    console.error('Error update status infouser : ', error);
  }
}

async function offUser(id) {
  try {
    let query = `
    UPDATE info_user
    SET status='false',online_time=NOW()
    WHERE user_id=$1`;
    const result = await client.query(query, [id]);
    return result.rows;
  } catch (error) {
    console.error('Error update status infouser : ', error);
  }
}
