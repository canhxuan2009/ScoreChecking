const https = require('https');

const houseNames = { 1: 'Bravery (Tím)', 2: 'Brilliance (Đỏ)', 3: 'Balance (Xanh lá)' };

function setHypesquad(token, houseId) {
  return new Promise((resolve, reject) => {
    if (!token) {
      return reject(new Error('Token không hợp lệ.'));
    }

    if (!houseId || houseId < 1 || houseId > 3) {
      return reject(new Error('House ID không hợp lệ (chỉ nhận 1, 2, 3).'));
    }

    console.log(`\n🏠 Đang thực hiện lấy huy hiệu HypeSquad: ${houseNames[houseId]}...`);

    const options = {
      hostname: 'discord.com',
      port: 443,
      path: '/api/v9/hypesquad/online',
      method: 'POST',
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Discord/1.0.9189 Chrome/120.0.6099.291 Electron/28.3.1 Safari/537.36',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 204) {
          console.log(`✅ Lấy huy hiệu HypeSquad ${houseNames[houseId]} thành công!`);
          resolve(`Lấy huy hiệu HypeSquad **${houseNames[houseId]}** thành công!`);
        } else {
          console.log(`❌ Lỗi khi lấy huy hiệu (${res.statusCode}): ${data}`);
          reject(new Error(`Lỗi (${res.statusCode}): ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      console.error('❌ Lỗi kết nối:', err.message);
      reject(err);
    });

    req.write(JSON.stringify({ house_id: parseInt(houseId) }));
    req.end();
  });
}

module.exports = { setHypesquad, houseNames };
