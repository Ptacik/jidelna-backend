const express = require('express');
const axios = require('axios');
const qs = require('qs');
const cheerio = require('cheerio');
const cors = require('cors');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const path = require('path'); 

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// TENTO ŘÁDEK JE NEJDŮLEŽITĚJŠÍ:
// Říká serveru: "Obsah složky 'public' je náš web"
app.use(express.static(path.join(__dirname, 'public')));

// URL ŠKOLY
const BASE_URL = "https://sj.soanachod.cz";
const LOGIN_URL = `${BASE_URL}/j_spring_security_check`;
const MENU_URL = `${BASE_URL}/faces/secured/main.jsp`;

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Chybí jméno nebo heslo" });

    try {
        const jar = new CookieJar();
        const client = wrapper(axios.create({ jar }));

        // 1. Login
        await client.post(LOGIN_URL, qs.stringify({
            'j_username': username,
            'j_password': password,
            'targetUrl': '/faces/secured/main.jsp'
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }
        });

        // 2. Data
        const response = await client.get(MENU_URL);
        const html = response.data;

        if (html.includes("Přihlášení") || !html.includes("jidelnicekDen")) {
             return res.status(401).json({ error: "Špatné jméno nebo heslo." });
        }

        // 3. Parsing
        const $ = cheerio.load(html);
        let outputHTML = "";
        
        $('.jidelnicekDen').each((i, element) => {
            let date = $(element).text().split("\n")[1].trim();
            if(date.length > 50) date = $(element).find('span').first().text();
            let dayHTML = `<div class='day-card'><div class='day-header'>${date}</div>`;
            let hasFood = false;
            
            const mealTypes = [
                { name: "Polévka", class: "badge-pol" },
                { name: "Menu 1", class: "badge-m1" },
                { name: "Menu 2", class: "badge-m2" },
                { name: "Menu 3", class: "badge-m3" },
                { name: "Svačina", class: "badge-pol" }
            ];
            
            const textContent = $(element).text();
            mealTypes.forEach(type => {
                if(textContent.includes(type.name)) {
                    let parts = textContent.split(type.name);
                    if(parts[1]) {
                        let foodName = parts[1].split("Obsahuje")[0].split("Objednat")[0].trim();
                        mealTypes.forEach(mt => { foodName = foodName.split(mt.name)[0]; });
                        foodName = foodName.replace(/^[\s:-]+/, '').trim();
                        if(foodName.length > 2) {
                            dayHTML += `<div class='meal-row'><div class='meal-badge ${type.class}'>${type.name}</div><div class='meal-text'>${foodName}</div></div>`;
                            hasFood = true;
                        }
                    }
                }
            });
            dayHTML += "</div>";
            if(hasFood) outputHTML += dayHTML;
        });

        if(!outputHTML) return res.status(200).send("Menu nenalezeno.");
        res.send(outputHTML);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server běží na portu ${PORT}`));
