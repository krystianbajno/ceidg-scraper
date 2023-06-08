import * as fs from 'fs';

(async () => {
    const ban_list = JSON.parse(fs.readFileSync('./ban_list.json'))
    const keys_translation_kv = JSON.parse(fs.readFileSync('./keys.json'))
    const keys_translation = {}

    for (const key in keys_translation_kv) {
      const values = keys_translation_kv[key];
      values.forEach(value => {
        keys_translation[value] = key;
      });
    }

    const destination = "merged_results.json"
    const source = JSON.parse(fs.readFileSync("./output.json"))
    const source_2 = JSON.parse(fs.readFileSync("./cache/sale_balowe_v1/sale_balowe_v1.json"))

    let hashmap = {}

    for (const company of source_2) {
        try {
            company.category = keys_translation[additionalData.searchTerm]
        } catch {
            company.category = company.searchTerm
        }

        hashmap[company.id] = company
    }


    for (const company of source) {
      hashmap[company.id] = company
    }

    const output = []

    for (const key of Object.keys(hashmap)) {
        console.log(key)
        if (hashmap[key].last_name.toLowerCase().includes(hashmap[key].searchTerm.toLowerCase())) {
          continue
        }
    
        if (ban_list.some(i => hashmap[key].company_name.toLowerCase().includes(i))  ) {
          continue
        }
    
        output.push(hashmap[key])
    }

    console.log(output.length)

    const categories = Object.keys(keys_translation_kv).map(i => ({"Kategoria": i}))
    fs.writeFileSync("categories.json", JSON.stringify(categories))
    fs.writeFileSync(destination, JSON.stringify(output))
})();