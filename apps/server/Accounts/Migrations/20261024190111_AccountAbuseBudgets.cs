using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Telae.Server.Accounts.Migrations
{
    /// <inheritdoc />
    public partial class AccountAbuseBudgets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "FailedCodeAttempts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    Purpose = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FailedCodeAttempts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FailedCodeAttempts_Accounts_AccountId",
                        column: x => x.AccountId,
                        principalTable: "Accounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PasswordAttempts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientAddressHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    AppliesToPair = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PasswordAttempts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PasswordAttempts_Accounts_AccountId",
                        column: x => x.AccountId,
                        principalTable: "Accounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_FailedCodeAttempts_AccountId_Purpose_CreatedAt",
                table: "FailedCodeAttempts",
                columns: new[] { "AccountId", "Purpose", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_PasswordAttempts_AccountId_CreatedAt",
                table: "PasswordAttempts",
                columns: new[] { "AccountId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FailedCodeAttempts");

            migrationBuilder.DropTable(
                name: "PasswordAttempts");
        }
    }
}
