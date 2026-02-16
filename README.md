# 🤖 Azure Intelligent Support Bot

<p align="center">
  <b>Cloud-Deployed AI Tech Support Assistant powered by Microsoft Azure</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18%2B-green?style=for-the-badge&logo=node.js">
  <img src="https://img.shields.io/badge/Azure-AI%20Language-0078D4?style=for-the-badge&logo=microsoft-azure">
  <img src="https://img.shields.io/badge/Bot-Framework-blue?style=for-the-badge">
  <img src="https://img.shields.io/badge/Cloud-Render-purple?style=for-the-badge">
  <img src="https://img.shields.io/badge/Status-Live-brightgreen?style=for-the-badge">
</p>

---

## 📚 Academic Context

Developed for:

**CSC 490 – Artificial Intelligence**  
University of Lynchburg  
Spring 2026  

This project demonstrates the integration of Microsoft Azure AI services into a real-world cloud-deployed application.

🔗 **Live Demo**  
https://azure-intelligent-support-bot.onrender.com  

🔗 **GitHub Repository**  
https://github.com/Vitolop1/azure-intelligent-support-bot  

---

## 🧠 Project Overview

Azure Intelligent Support Bot is a production-style conversational assistant that simulates a modern IT support agent.

The system integrates Azure AI Language Service to analyze user messages in real time and dynamically guide troubleshooting workflows.

### AI Capabilities

- Sentiment Analysis  
- Key Phrase Extraction  
- Language Detection  
- PII (Sensitive Data) Recognition  

The bot adapts tone based on sentiment and generates structured, step-by-step troubleshooting flows.

---

## 🏗 System Architecture

```
User (Web UI or Emulator)
        ↓
Node.js + Restify Server
        ↓
Azure AI Language Service
        ↓
NLP Analysis (Sentiment + Key Phrases + PII)
        ↓
Guided Troubleshooting Logic
        ↓
Structured Response
```

---

## ⚙️ Technology Stack

| Technology | Purpose |
|------------|----------|
| Node.js | Backend runtime |
| Restify | Web server |
| Bot Framework SDK | Conversational layer |
| Azure AI Language | NLP processing |
| Render | Cloud hosting |
| Environment Variables | Secure key management |

---

## 🚀 Running Locally

### 1. Clone the repository

```bash
git clone https://github.com/Vitolop1/azure-intelligent-support-bot.git
cd azure-intelligent-support-bot
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create a `.env` file

```
LANGUAGE_ENDPOINT=your_azure_endpoint
LANGUAGE_KEY=your_azure_key
BOT_APP_ID=
BOT_APP_PASSWORD=
PORT=3978
```

### 4. Start the server

```bash
npm start
```

Open in browser:

```
http://localhost:3978
```

---

## ☁️ Cloud Deployment

The application is deployed publicly using Render.

Base URL:
```
https://azure-intelligent-support-bot.onrender.com
```

Health Check:
```
GET /health
```

Web Chat:
```
GET /
```

Bot Framework Endpoint:
```
POST /api/messages
```

---

## 🔐 Security Considerations

- `.env` excluded via `.gitignore`
- Azure credentials never committed
- Environment variables configured securely in production
- PII detection warns users about sensitive data
- Server-side validation implemented

---

## 📚 Learning Outcomes

Through this project, I gained experience with:

- Azure AI service integration
- REST API design
- Session state management
- Secure credential handling
- Cloud deployment workflows
- Production debugging and log analysis

---

## 👨‍💻 Author

**Vito Loprestti**  
Computer Science Student  
University of Lynchburg  

GitHub: https://github.com/Vitolop1  

---

<p align="center">
  <b>Built with Microsoft Azure AI 🚀</b>
</p>
