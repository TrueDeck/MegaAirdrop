const Web3 = require('web3');
const TruffleContract = require('truffle-contract');
const BigNumber = require('bignumber.js');
const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');

var blockNumber = 0;
var spreadsheetId = process.argv[2];

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
const TOKEN_PATH = 'token.json';

var json = require('./build/contracts/TrueDeckToken.json');

var provider = new Web3.providers.HttpProvider("http://localhost:8545");
let web3 = new Web3(provider);

web3.eth.net.isListening().then(() => {
    console.log('Web3 connected successfully...');

    console.log('Reading snapshot spreadsheet...')
    fs.readFile('credentials.json', (err, content) => {
        if (err) return console.log('Error loading client secret file:', err);
        authorize(JSON.parse(content), validateSnapshot);
    });
}).catch((e) => {
    console.log('No local node found, using INFURA...');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question('Provide with INFURA endpoint: ', (endpoint) => {
        rl.close();

        provider = new Web3.providers.HttpProvider(endpoint);
        web3 = new Web3(provider);
        web3.eth.net.isListening().then(() => {
            console.log('Web3 connected successfully...');

            console.log('Reading snapshot spreadsheet...')
            fs.readFile('credentials.json', (err, content) => {
                if (err) return console.log('Error loading client secret file:', err);
                authorize(JSON.parse(content), validateSnapshot);
            });
        }).catch(e => {
            console.log('Web3 connection error, exiting...');
            process.exit(1);
        });
    });
});

async function validateSnapshot(auth) {
    const sheets = google.sheets({version: 'v4', auth});
    if (!spreadsheetId) {
        spreadsheetId = '1LXDdl5s6v5FZ6XHQJn7jk2ZN4H7Ptqjt-DRFX0FaPIw';
    }

    sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetId,
        range: 'Sheet1!A3',
    }, async (err, res) => {
        if (res) {
            blockNumber = res.data.values[0][0].match(/\d+/g)[0];
        } else {
            console.log('No block found in spreadsheet, please wait till a block is chosen...');
            process.exit(1);
        }
    });

    sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetId,
        range: 'Sheet1!A5:B1004',
    }, async (err, res) => {
        if (err) return console.log('The API returned an error: ' + err);

        if (res && res.data.values && res.data.values.length) {
            const rows = res.data.values;
            console.log(`${rows.length} holders...`);
            console.log('Starting snapshot validation...');
            console.log('-------------------------------------');

            let valid = true;

            valid &= await validateTotalSupply(rows);

            let TrueDeckToken = TruffleContract(json);
            TrueDeckToken.setProvider(provider);
            let token = await TrueDeckToken.deployed();

            valid &= await validateToken(token);

            valid &= await validateTokenHoldersBalances(token, rows);

            console.log('-------------------------------------');
            console.log(`Snapshot Validation: ${valid ? 'SUCCESS' : 'FAILED'}`);
        } else {
            console.log('No data found. Wait for the snapshot.');
            process.exit(1);
        }
    });
}

async function validateTotalSupply(rows) {
    let valid = true;
    let totalSupply = new BigNumber(0);
    for (let i = 0; i < rows.length; i++) {
        const balance = new BigNumber(rows[i][1]);
        totalSupply = totalSupply.plus(balance);
    }
    valid = totalSupply.isEqualTo(new BigNumber('2e+26'));
    console.log(`- Validating total supply: ${valid}`);
    return valid;
}

async function validateToken(token) {
    let valid = true;

    let name = await token.name();
    valid = valid & (name == 'TrueDeck');

    let symbol = await token.symbol();
    valid = valid & (symbol == 'TDP');

    console.log(`- Validating token: ${(valid === 1)}`);
    return valid;
}

async function validateTokenHoldersBalances(token, rows) {
    let valid = true;

    console.log(`- Validating token holder balances at Block #${blockNumber}`);

    let totalSupplySnapshot = new BigNumber(0);
    let totalSupplyBlockchain = new BigNumber(0);

    for (let i = 0; i < rows.length; i++) {
        let balance = await token.balanceOf(rows[i][0], blockNumber);

        totalSupplySnapshot = totalSupplySnapshot.plus(rows[i][1]);
        totalSupplyBlockchain = totalSupplyBlockchain.plus(balance);

        let validBalance = (balance == rows[i][1]);
        console.log('  ------');
        console.log(`  - Address: ${rows[i][0]}`);
        console.log(`  - Balance at Block #${blockNumber}:`);
        console.log(`    - Snapshot:   ${rows[i][1]}`);
        console.log(`    - Blockchain: ${balance}`);
        console.log(`  - Valid: ${validBalance}`);
        valid = valid & validBalance;
    }

    console.log('  ------');
    console.log(`- Validating token holder balances at Block #${blockNumber}: ${(valid === 1)}`);
    return valid;
}

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
    const {client_secret, client_id, redirect_uris} = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(
            client_id, client_secret, redirect_uris[0]);

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) return getNewToken(oAuth2Client, callback);
        oAuth2Client.setCredentials(JSON.parse(token));
        callback(oAuth2Client);
    });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error('Error while trying to retrieve access token', err);
            oAuth2Client.setCredentials(token);
            // Store the token to disk for later program executions
            fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                if (err) console.error(err);
                console.log('Token stored to', TOKEN_PATH);
            });
            callback(oAuth2Client);
        });
    });
}
