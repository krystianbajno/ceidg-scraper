import puppeteer from 'puppeteer';
import * as fs from 'fs';
import { parse } from 'json2csv';

const keys_translation = {}
const getDataFilesKv = (campaign) => {
  return fs.readdirSync(`cache/${campaign}`).map(fileName => fileName.split(".json")[0]).map(i => {
    return {
      key: i.split("_")[1],
      city: i.split("_")[0].split("+")[1],
      voivodeship: i.split("_")[0].split("+")[0]
    }
  })
}

const getDataFilesList = (campaign) => {
  return fs.readdirSync(`cache/${campaign}`);
}

const saveCompanies = (campaign, voivodeship, city, key, companies) => {
  const fileName = `cache/${campaign}/${voivodeship}+${city}_${key}.json`
  console.log(`Saving to ${fileName}`)
  fs.writeFileSync(fileName, JSON.stringify(companies))
}

const ceidgSearch = async (campaign, voivodeship_cities, keys) => {
  const all_files = keys.length * voivodeship_cities.length
  let index = 0
  let iter_to_skip = getDataFilesKv(campaign)

  const browser = await puppeteer.launch({headless: false, defaultViewport: null});

  for (const voivodeship_city of voivodeship_cities) {
    const voivodeship = voivodeship_city.voivodeship
    const city = voivodeship_city.city

    for (const key of keys) {
      if (iter_to_skip.find(i => i.key == key && i.city == city && i.voivodeship == voivodeship)) {
        index = index + 1
        console.log(`- Skipping ${key} ${city} ${voivodeship}`)
        continue
      }

      try {
        console.log(`[*] Searching: name ${key}, voivodeship ${city} ${voivodeship}`)
        const termCompanies = await searchCompany(key, voivodeship, city, browser)
        console.log(termCompanies)
        saveCompanies(campaign, voivodeship, city, key, termCompanies)
        index = index + 1
        console.log(`[Progress]: ${index}/${all_files}`)
      } catch (e) {
        console.log(e, `ERROR at ${key}, ${voivodeship} ${city}`)
      }
    }
  }

  browser.close()
}

const scrapCompany = async (companyHref, additionalData, browser) => {
  const company = {}
  const page = await browser.newPage();
  await page.goto(companyHref);
  

  company.id = additionalData.companyId,
  company.company_name = await page.evaluate(() => document.querySelector('#MainContentForm_lblName').innerHTML);
  company.first_name = await page.evaluate(() => document.querySelector('#MainContentForm_lblFirstName').innerHTML);
  company.last_name = await page.evaluate(() => document.querySelector('#MainContentForm_lblLastName').innerHTML);
  company.nip = await page.evaluate(() => document.querySelector('#MainContentForm_lblNip').innerHTML);
  company.regon = await page.evaluate(() => document.querySelector('#MainContentForm_lblRegon').innerHTML);
  company.address = await page.evaluate(() => document.querySelector('#MainContentForm_lblPlaceOfBusinessAddress').innerHTML);
  company.address_2 = await page.evaluate(() => document.querySelector('#MainContentForm_lblCorrespondenceAddress').innerHTML);
  company.phone =  await page.evaluate(() => document.querySelector('#MainContentForm_lblPhone').innerHTML);
  company.city = additionalData.city
  company.voivodeship = additionalData.voivodeship,
  company.searchTerm = additionalData.searchTerm,
  company.ceidg_url = companyHref
  company.category = keys_translation[additionalData.searchTerm]

  try {
    company.email = await page.evaluate(() => document.querySelector('#MainContentForm_lblEmail > a').innerHTML);  
  } catch {
    company.email = null
  }

  page.close()

  return company
}

const searchCompany = async (companyName, voivodeship, city, browser) => {
  const BASE_COMPANY_URL = "https://aplikacja.ceidg.gov.pl/ceidg/ceidg.public.ui/"
  const CHUNK_SIZE = 15
    
  const page = await browser.newPage();

  await page.goto('https://aplikacja.ceidg.gov.pl/ceidg/ceidg.public.ui/search.aspx');
  await page.setViewport({width: 1366, height: 768});

  await page.$eval('#MainContentForm_txtName', el => el.value = '');
  await page.$eval('#MainContentForm_txtCity', el => el.value = '');
  await page.$eval('#MainContentForm_txtProvince', el => el.value = '');

  await page.type('#MainContentForm_txtName', companyName);
  await page.type('#MainContentForm_txtCity', city);
  await page.type('#MainContentForm_txtProvince', voivodeship);
  
  await page.evaluate(() => {
    document.querySelector('#MainContentForm_btnInputSearch').click();
});

  await page.waitForNavigation()

  const companies = await page.$$(".searchITA")
  let hrefs = await Promise.all(companies.map(company => company.evaluate(x => x.getAttribute('href'))))

  hrefs = hrefs.map(x => BASE_COMPANY_URL + x) 

  const chunks = hrefs.map((_, i, all) => all.slice(CHUNK_SIZE*i, CHUNK_SIZE*i+CHUNK_SIZE)).filter(x=>x.length)

  let companiesAll = {}

  for (const chunk of chunks) {
    const companies = await Promise.all(chunk.map(href => scrapCompany(href, {
      searchTerm: companyName,
      companyId: href.split("Id=")[1],
      city: city,
      voivodeship: voivodeship
    }, browser)))

    for (const company of companies) {
      companiesAll[company.id] = company
    }
  }

  page.close()

  return companiesAll
}

(async () => {
  const CHROME_INSTANCES = 3
  const CHUNK_SIZE = keys.length / CHROME_INSTANCES

  const voivodeships_cities = JSON.parse(fs.readFileSync('./data/cities.json'))
  const config = JSON.parse(fs.readFileSync('./config.json'))
  const campaign = config.campaign
  const ban_list = config.ban_list
  const keys_translation_kv = config.keys

  for (const key in keys_translation_kv) {
    const values = keys_translation_kv[key];
    values.forEach(value => {
      keys_translation[value] = key;
    });
  }
  
  const keys = []
  Object.keys(keys_translation_kv).map(key => {
    keys_translation_kv[key].map(v => {
      keys.push(v)
    })
  })

  if (!fs.existsSync(`cache/${campaign}`)) {
    fs.mkdir(`cache/${campaign}`);
  }

  const chunks = keys.map((_, i, all) => all.slice(CHUNK_SIZE*i, CHUNK_SIZE*i+CHUNK_SIZE)).filter(x=>x.length)

  // FETCH
  await Promise.all(chunks.map(chunk => ceidgSearch(campaign, voivodeships_cities, chunk)))
  await ceidgSearch(campaign, voivodeships_cities, keys)

  // MERGE
  let key_val_dict = {}
  for (const file of getDataFilesList(campaign)) {
    const data = JSON.parse(fs.readFileSync(`cache/${campaign}/${file}`))

    for (const obj in data) {
      const originalKey = keys.find(i => data[obj].searchTerm.includes(i))
      data[obj].searchTerm = originalKey
    }

    key_val_dict = { ...key_val_dict, ...data}
  }

  // FILTER
  const output = []
  for (const key of Object.keys(key_val_dict)) {
    console.log(key)
    if (key_val_dict[key].last_name.toLowerCase().includes(key_val_dict[key].searchTerm.toLowerCase())) {
      continue
    }

    if (ban_list.some(i => key_val_dict[key].company_name.toLowerCase().includes(i))) {
      continue
    }

    output.push(key_val_dict[key])
  }

  console.log(output.length)

  const categories = Object.keys(keys_translation_kv).map(i => ({"Kategoria": i}))
  fs.writeFileSync(`./results/${campaign}-categories.json`, JSON.stringify(categories))
  fs.writeFileSync(`./results/${campaign}.json`, JSON.stringify(output))
  fs.writeFileSync(`./results/${campaign}}.csv`, parse(output))
})();