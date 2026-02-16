# 🤖 Azure Intelligent Support Bot

<p align="center">
  <b>AI-Powered Tech Support Assistant built with Microsoft Azure & Bot Framework</b>
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

This project was developed for:

**CSC 490 – Artificial Intelligence**  
University of Lynchburg  
Spring 2026  

The objective was to integrate Microsoft Azure AI services into a functional cloud-based application and demonstrate real-world AI deployment architecture.

Live Service (Health Endpoint):  
👉 https://azure-intelligent-support-bot.onrender.com  

GitHub Repository:  
👉 https://github.com/Vitolop1/azure-intelligent-support-bot  

---

## 🧠 Overview

**Azure Intelligent Support Bot** is a cloud-integrated conversational assistant that simulates a modern technical support agent.

It analyzes user messages using:

- ✅ Sentiment Analysis  
- ✅ Key Phrase Extraction  
- ✅ Language Detection  
- ✅ PII Detection  

All powered by **Azure AI Language Service**.

---

## 🎯 Project Objective

The goal of this project was to:

- Integrate Azure Cognitive Services into a live Node.js backend  
- Demonstrate secure cloud-based AI processing  
- Build a production-style conversational assistant  
- Analyze real-time user sentiment  
- Implement guided troubleshooting flows  
- Deploy the solution publicly  

---

## ⚙️ Tech Stack

| Technology | Purpose |
|------------|----------|
| Node.js | Backend runtime |
| Restify | Web server |
| Bot Framework SDK | Bot communication layer |
| Azure AI Language | NLP processing |
| Azure AD | Authentication (optional) |
| Render | Public cloud hosting |

---

## 🏗 System Architecture

```
User
   ↓
Bot Framework Emulator / Web Channel
   ↓
Node.js Server (Restify)
   ↓
Azure AI Language Service
   ↓
Sentiment + Key Phrases + PII Detection
   ↓
Guided Troubleshooting Response
```

---

## 🚀 Installation (Local Setup)

### 1️⃣ Clone the repository

```bash
git clone https://github.com/Vitolop1/azure-intelligent-support-bot.git
cd azure-intelligent-support-bot
```

### 2️⃣ Install dependencies

```bash
npm install
```

### 3️⃣ Create a `.env` file

```
LANGUAGE_ENDPOINT=your_azure_endpoint
LANGUAGE_KEY=your_azure_key
BOT_APP_ID=
BOT_APP_PASSWORD=
PORT=3978
```

### 4️⃣ Start the bot

```bash
npm start
```

### 5️⃣ Connect using Bot Framework Emulator

```
http://localhost:3978/api/messages
```

---

## ☁️ Live Deployment

The application is deployed on Render.

Base URL:
```
https://azure-intelligent-support-bot.onrender.com
```

Health check endpoint:
```
GET /
```

Bot endpoint:
```
POST /api/messages
```

---

## 💬 Example Interaction

**User:**  
My internet is not working and I’m frustrated.

**Bot:**  
I got you — we’ll fix this 💪  
Network mode activated. Are you on Wi-Fi or Ethernet?

---

## 🔐 Security Practices

- `.env` excluded via `.gitignore`
- Azure credentials never committed
- Environment variables securely handled
- PII detection warning system implemented
- Safe redaction recommendations included

---

## 📚 Learning Outcomes

This project demonstrates:

- Cloud AI integration  
- REST API architecture  
- Secure credential management  
- Azure AI Language usage  
- Session state handling  
- Real-time sentiment-aware response design  
- Public cloud deployment workflow  

---

## 👨‍💻 Author

**Vito Loprestti**  
Computer Science Student  
University of Lynchburg  

GitHub: https://github.com/Vitolop1  

---

## 🏁 Project Status

✔ Fully Functional  
✔ Azure AI Integrated  
✔ Publicly Deployed  
✔ Academic Submission Ready  

---

<p align="center">
  <b>Built with Azure AI 🚀</b>
</p>
