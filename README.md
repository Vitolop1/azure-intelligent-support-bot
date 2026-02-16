🤖 Azure Intelligent Support Bot










AI-powered Tech Support Assistant built with Microsoft Azure AI and Bot Framework SDK

Developed by Vito Loprestti
CS-380 Artificial Intelligence – Module 5

🧠 Overview

Azure Intelligent Support Bot is a cloud-integrated conversational assistant designed to simulate a modern technical support agent.

The bot analyzes user messages using Azure AI Language Service (Sentiment Analysis) and generates intelligent, contextual responses.

This project demonstrates real-world integration of:

Microsoft Bot Framework

Azure AI Language Service

Azure Active Directory Authentication

Node.js backend architecture

Cloud deployment readiness

🎯 Objective

The purpose of this project is to:

Integrate Azure Cognitive Services into a live application

Demonstrate secure cloud-based AI processing

Build a production-style conversational bot

Analyze real-time user sentiment

Simulate intelligent technical support behavior

⚙️ Tech Stack

Node.js

Restify

Bot Framework SDK

Azure AI Language (Sentiment Analysis)

Azure AD Authentication

Render / Azure App Service (Deployment Ready)

🏗 Architecture Flow

User
↓
Bot Framework Emulator / Web Channel
↓
Node.js Server
↓
Azure AI Language Service
↓
Sentiment Analysis
↓
Response Returned to User

🚀 Installation (Local Setup)

Clone the repository:

git clone https://github.com/Vitolop1/azure-intelligent-support-bot.git
cd azure-intelligent-support-bot
npm install


Create a .env file in the root directory:

LANGUAGE_ENDPOINT=your_azure_endpoint
LANGUAGE_KEY=your_azure_key
BOT_APP_ID=
BOT_APP_PASSWORD=
PORT=3978


Start the bot:

npm start


Then connect using Bot Framework Emulator:

http://localhost:3978/api/messages

💬 Example Interaction

User:
Hi, I love this class

Bot:
I detect your sentiment as: positive (pos 0.92, neu 0.06, neg 0.02)

🔐 Security

.env file is excluded via .gitignore

Azure credentials are never committed

Uses secure Azure authentication flow

Environment variables managed safely

☁️ Deployment

This bot is fully deployable to:

Render

Azure App Service

Azure Web Apps

Azure Container Apps

Start command:

npm start

📚 Learning Outcomes

This project demonstrates:

Cloud AI integration

REST API handling

Secure credential management

Azure Cognitive Services usage

Production-style backend design

Real-time sentiment analysis

👨‍💻 Author

Vito Loprestti
Computer Science Student
University of Lynchburg

GitHub: https://github.com/Vitolop1

🏁 Status

Functional
Azure Integrated
Cloud Deployable
Production-Ready Structure