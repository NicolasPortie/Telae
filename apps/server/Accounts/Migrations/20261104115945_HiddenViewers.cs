using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Telae.Server.Accounts.Migrations
{
    /// <inheritdoc />
    public partial class HiddenViewers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "HiddenViewers",
                columns: table => new
                {
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    HiddenId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HiddenViewers", x => new { x.AccountId, x.HiddenId });
                    table.ForeignKey(
                        name: "FK_HiddenViewers_Accounts_AccountId",
                        column: x => x.AccountId,
                        principalTable: "Accounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_HiddenViewers_Accounts_HiddenId",
                        column: x => x.HiddenId,
                        principalTable: "Accounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_HiddenViewers_HiddenId",
                table: "HiddenViewers",
                column: "HiddenId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "HiddenViewers");
        }
    }
}
