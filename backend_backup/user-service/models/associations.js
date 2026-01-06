import User from "./User.js";
import Address from "./Address.js";

const defineAssociations = () => {
    // A User has many Addresses
    User.hasMany(Address, { 
        foreignKey: "userId", 
        as: "addresses", // Optional alias
        onDelete: "CASCADE" 
    });

    // An Address belongs to a User
    Address.belongsTo(User, { 
        foreignKey: "userId" 
    });
};

export default defineAssociations;