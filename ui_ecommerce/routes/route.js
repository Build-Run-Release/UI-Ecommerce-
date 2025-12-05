const express = require("express");
const router = express.Router();

router.get("/", async (req, res) => {
    res.render("index", {
        user: {
            username: "@fakeuser",
            role: "buyer",
        },
        ads: [],
        products: [],
    });
});

router.get("/login", async (req, res) => {
    res.render("login");
});

router.get("/signup", async (req, res) => {
    res.render("signup");
});
            

module.exports = router;
