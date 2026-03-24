const express = require('express');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/scenarios', require('./routes/scenarios'));

app.get('/', (req, res) => {
  res.redirect('/scenarios');
});

function startWebServer(port = 3000) {
  app.listen(port, () => {
    console.log(`[Web] Scenario management UI: http://localhost:${port}`);
  });
}

module.exports = { startWebServer };
