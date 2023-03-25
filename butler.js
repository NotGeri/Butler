import express from 'express';
import axios from 'axios';
import dedent from 'dedent-js';
import * as dotenv from 'dotenv';
import {Configuration, OpenAIApi} from 'openai';

// Get .env settings
dotenv.config();

// Initialize OpenAI API
const configuration = new Configuration({organization: 'org-zdTlhY1Yc8EXzKH8GRYz8XJP', apiKey: process.env.openAIKey});
const openai = new OpenAIApi(configuration);

// Initialize Express server
const app = express();

// Let any other request time out, we don't care
app.put('/*', () => {
});
app.delete('/*', () => {
});

app.get('/emergencySummary/:cardId', /* authenticate, */ async (req, res) => {
    const cardId = req.params.cardId;
    console.info(`Handling emergency summary for card ${cardId}`);

    try {
        const {card, formattedComments} = await getCardDetails(cardId);
        const text = await getPromptAnswer(`
        Write up a Trello card comment with a timeline of events that took place in the card.
        The format of each timeline entry should be: - \`YYYY/MM/DD DATE AND HH:MM TIME HERE\`: BRIEF DESCRIPTION HERE
        The date and time should be copied from the comment.
        Surround the time and date with backticks, such as \`DATE AND TIME HERE\`, this is crucial.
        Almost each comment should have its own entry. The description for each should be 1-2 sentences at most.
        
        You will now get the title, description and each comment on the card.
        Comments start with the time in '[]', then the name of the user and the message after ':'
        --- 
        Title: ${card.name}
        ---
        Description: ${card.desc}
        ---
        Comments:
        ${formattedComments}
        ---
        Data over, now write your timeline of the card:
        `, false);

        console.info(text);

        res.json({text});
    } catch (e) {
        res.status(500).json({result: e.response.data.error || e.message || e});
    }
});

app.post('/bugsSummary/:cardId', authenticate, async (req, res) => {
    const cardId = req.params.cardId;
    console.info(`Handling summary for card ${cardId}`);

    try {
        const {card, formattedComments} = await getCardDetails(cardId);

        const text = await getPromptAnswer(`
        Summarize only the issue in this Trello card as a less than a 20-word meeting writeup without new lines.
        You will now get the title, description and each comment on the card.
        Comments start with the time in '[]', then the name of the user and the message after ':'
        --- 
        Title: ${card.name}
        ---
        Description: ${card.desc}
        ---
        Comments:
        ${formattedComments}
        ---
        Data over, now write your summary of the card:
        `);


        const response = await updateCustomField(cardId, text);
        console.log(text);

        res.status(200).json({result: text});
    } catch (e) {
        res.status(500).json({result: e.message || e});
    }
});

async function getCardById(cardId) {
    const resp = await axios.get(formatEndpoint(`/cards/${cardId}`));
    if (resp.status !== 200) throw new Error(`Trello API returned code ${resp.status}: ${resp.message}`);
    return resp.data;
}

async function getCardComments(cardId) {
    const resp = await axios.get(`${formatEndpoint(`/cards/${cardId}/actions`)}&filter=commentCard,copyCommentCard`);
    if (resp.status !== 200) throw new Error(`Trello API returned code ${resp.status}: ${resp.message}`);
    return resp.data;
}

async function getMember(id) {
    const resp = await axios.get(formatEndpoint(`/members/${id}`));
    if (resp.status !== 200) throw new Error(`Trello API returned code ${resp.status}: ${resp.message}`);
    return resp.data;
}

async function updateCustomField(id, content) {
    const resp = await axios.put(formatEndpoint(`/cards/${id}/customField/${process.env.trelloFieldId}/item`), {'value': {'text': content}});
    if (resp.status !== 200) throw new Error(`Trello API returned code ${resp.status}: ${resp.message}`);
    return resp.data;
}

function formatEndpoint(link) {
    return `https://api.trello.com/1/${link}?key=${process.env.trelloKey}&token=${process.env.trelloToken}`;
}

function authenticate(req, res, next) {
    const token = req.headers.authorization;
    if (token === process.env.authToken) {
        return next();
    } else {
        return res.status(401).json({error: 'Invalid token'});
    }
}

async function getPromptAnswer(prompt, format = true) {
    prompt = dedent(prompt);
    const completion = await openai.createCompletion({
        model: 'text-davinci-003',
        prompt: prompt,
        temperature: 0.6,
        max_tokens: 2048
    });

    let text = completion.data.choices[0].text || '';
    if (!format) return text;
    return text.replaceAll('\n', ' ').trim();
}

async function getCardDetails(cardId) {
    const card = await getCardById(cardId);
    const comments = await getCardComments(cardId);

    let formattedComments = '';
    for (const comment of comments) {
        const creator = await getMember(comment.idMemberCreator);

        const estFormatter = new Intl.DateTimeFormat('hu-HU', {
            timeZone: 'EST',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            formatMatcher: 'basic',
            separator: '/'
        });

        // Format the date as a string in yyyy/mm/dd HH:MM format but for EST
        const regex = /^(?<year>\d{4})\. (?<month>\d{2})\. (?<day>\d{2})\. (?<hour>\d{2}):(?<minute>\d{2})$/;
        const rawDate = estFormatter.format(new Date(comment.date));
        const match = regex.exec(rawDate);

        let date = 'Unknown';
        if (match) {
            const {year, month, day, hour, minute} = match.groups;
            date = `${year}/${month}/${day} ${hour}:${minute}`;
        }

        let text = comment?.data?.text?.replace('\n', ' ');
        if (text.length > 512) text = text.substring(0, 512);

        formattedComments += `[${date}] ${creator.fullName}: ${text}\n`;
    }

    return {card, formattedComments};
}

app.listen(process.env.port || 12345, () => {
    console.log('Butler server listening...');
});