using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Telae.Server.Accounts;

/// <summary>Usado só pelas ferramentas do EF (<c>dotnet ef migrations add</c>): gera migrações para PostgreSQL sem precisar de um banco ativo.</summary>
public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<TelaeDbContext>
{
    public TelaeDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<TelaeDbContext>().UseNpgsql("Host=localhost;Database=telae_design").Options);
}
