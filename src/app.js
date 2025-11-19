const express = require("express");
const cors = require("cors");
const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:5173", // dev
      "https://dashboardtifronted.vercel.app", // prod viejo
      "https://dashboard.img360.com", // prod nuevo
    ],

    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  })
);

app.options("*", cors());

app.use(express.json());

const authRoutes = require("./routes/authRoutes.js");
app.use("/", authRoutes);

module.exports = app;
