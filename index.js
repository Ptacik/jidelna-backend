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
app.use(express.static(path.join(__dirname, 'public')));

// URL ŠKOLY
const BASE_URL = "https://sj.soanachod.cz";
const LOGIN_URL = `${BASE_URL}/j_spring_security_check`;
const MENU_URL = `${BASE_URL}/faces/secured/main.jsp`;
// --- TESTOVACÍ LINK ---
app.get('/test', async (req, res) => {
    try {
        console.log("📡 Zkouším dosáhnout na školní web...");
        // Zkusíme stáhnout jen úvodní stránku (bez cookies, bez loginu)
        const response = await axios.get(BASE_URL, {
            timeout: 5000, // 5 sekund limit
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        res.send(`✅ ÚSPĚCH! Školní web odpověděl. Status: ${response.status}. Jsme ve hře!`);
    } catch (error) {
        console.log("❌ CHYBA: " + error.message);
        res.send(`❌ SMŮLA: Školní web nás ignoruje. Chyba: ${error.message}. <br>To znamená, že blokují zahraniční IP adresy (Render).`);
    }
});

app.post('/login', async (req, res) => {
    console.log("👉 1. Signál přijat! Startuji...");
    
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Chybí údaje" });

    try {
        const jar = new CookieJar();
        
        // 🛠️ OPRAVA: Vyhodili jsme 'httpsAgent', který dělal problémy.
        // Nechali jsme ale 'headers', abychom vypadali jako prohlížeč.
        const client = wrapper(axios.create({ 
            jar, 
            timeout: 30000, // 30 sekund timeout
            withCredentials: true,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8',
                'Cache-Control': 'max-age=0',
                'Referer': BASE_URL + '/faces/login.jsp',
                'Origin': BASE_URL,
                'Upgrade-Insecure-Requests': '1'
            }
        }));

        console.log(`👤 Uživatel: ${username}`);

        // 1. KROK: Načtení úvodní stránky (pro cookies)
        console.log("🕵️ 1. Načítám web školy...");
        await client.get(BASE_URL); 

        // 2. KROK: Odeslání přihlášení
        console.log("📨 2. Odesílám heslo...");
        await client.post(LOGIN_URL, qs.stringify({
            'j_username': username,
            'j_password': password,
            'targetUrl': '/faces/secured/main.jsp'
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        // 3. KROK: Stažení jídelníčku
        console.log("🥗 3. Stahuji menu...");
        const response = await client.get(MENU_URL);
        const html = response.data;

        if (html.includes("Přihlášení") || !html.includes("jidelnicekDen")) {
             console.log("⛔ Přihlášení selhalo.");
             return res.status(401).json({ error: "Špatné heslo (nebo změna webu)." });
        }

        // 4. KROK: Parsování
        console.log("✅ 4. Mám data! Zpracovávám...");
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

        if(!outputHTML) return res.status(200).send("Jídelníček je prázdný.");
        
        res.send(outputHTML);

    } catch (error) {
        console.error("🔥 CHYBA:", error.message);
        res.status(500).json({ error: "Chyba serveru: " + error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server běží na portu ${PORT}`));

