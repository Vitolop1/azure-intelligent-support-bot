# 🤖 Azure Intelligent Support Bot

<p align="center">
  <b>AI-Powered Tech Support Assistant built with Microsoft Azure & Bot Framework</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18%2B-green?style=for-the-badge&logo=node.js">
  <img src="https://img.shields.io/badge/Azure-AI%20Language-0078D4?style=for-the-badge&logo=microsoft-azure">
  <img src="https://img.shields.io/badge/Bot-Framework-blue?style=for-the-badge">
  <img src="https://img.shields.io/badge/Status-Production%20Ready-brightgreen?style=for-the-badge">
</p>

---

## 🧠 Overview

**Azure Intelligent Support Bot** is a cloud-integrated conversational assistant that simulates a modern technical support agent.

It analyzes user messages using **Azure AI Language Service (Sentiment Analysis)** and generates contextual responses in real-time.

This project demonstrates a real-world integration of:

- Microsoft Bot Framework  
- Azure AI Language Service  
- Azure Active Directory Authentication  
- Node.js backend architecture  
- Cloud deployment readiness  

---

## 🎯 Project Objective

The goal of this project is to:

- Integrate Azure Cognitive Services into a live Node.js application  
- Demonstrate secure cloud-based AI processing  
- Build a production-style conversational assistant  
- Analyze real-time user sentiment  
- Simulate intelligent technical support behavior  

---

## ⚙️ Tech Stack

| Technology | Purpose |
|------------|----------|
| Node.js | Backend runtime |
| Restify | Web server |
| Bot Framework SDK | Bot communication layer |
| Azure AI Language | Sentiment Analysis |
| Azure AD | Authentication |
| Render / Azure App Service | Cloud Deployment |

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
Sentiment Analysis
   ↓
Intelligent Response Returned to User
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

## 💬 Example Interaction

**User:**  
Hi, I love this class  

**Bot:**  
I detect your sentiment as: positive (pos 0.92, neu 0.06, neg 0.02)

---

## 🔐 Security Practices

- `.env` file excluded via `.gitignore`
- Azure credentials never committed
- Secure Azure authentication flow
- Environment variables managed properly
- Production-ready structure

---

## ☁️ Deployment Ready

This bot can be deployed to:

- Azure App Service  
- Azure Web Apps  
- Azure Container Apps  
- Render  

Start command for deployment:

```bash
npm start
```

---

## 📚 Learning Outcomes

This project demonstrates:

- Cloud AI integration  
- REST API architecture  
- Secure credential management  
- Azure Cognitive Services usage  
- Production-style backend design  
- Real-time AI sentiment analysis  

---

## 👨‍💻 Author

**Vito Loprestti**  
Computer Science Student  
University of Lynchburg  

GitHub: https://github.com/Vitolop1  

---

## 🏁 Project Status

✔ Functional  
✔ Azure Integrated  
✔ Cloud Deployable  
✔ Production-Ready Structure  

---

<p align="center">
  <b>Built with Azure AI 🚀</b>
</p>
