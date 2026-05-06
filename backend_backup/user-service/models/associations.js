import User from "./User.js";
import Address from "./Address.js";

const defineAssociations = () => {
    User.hasMany(Address, { 
        foreignKey: "userId", 
        as: "addresses", 
        onDelete: "CASCADE" 
    });

    Address.belongsTo(User, { 
        foreignKey: "userId" 
    });
};

export default defineAssociations;