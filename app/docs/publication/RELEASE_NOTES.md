# Filterest 9.3.20

Visitors can no longer write to the database, no account can grant itself rights, and
a Docker installation can now start, update and back up like a native one.

## Visitors only read, and nobody grants themselves rights

The database account the application uses for visitors could add, change and delete
rows and advance number sequences, although no visitor feature writes anything. The
accounts of signed-in users could write to the views that edit database privileges and
run the two functions behind them, which act with the owner's rights, so a signed-in
account could have granted itself almost any right.

A startup stage now takes these rights away on every start, after the database updates
and before the first request, and compares what remains before and after: visitors only
read, and no ordinary account can use the privilege views or those functions. Every
other right stays as it was. If the stage cannot finish, the application does not start,
rather than serving with rights it should not have. Narrowing the signed-in users'
account to the tables it needs is the next stage.

## Docker installations start, update and back up

- **Update:** `./filterest update` now updates a Docker installation with the same
  safeguards as a native one. It checks that the release is published, backs up the
  database and reads the backup back before trusting it, keeps the uploaded files and
  the protected settings, and reports success only when the new version answers that it
  is compatible and is this installation. If the new version does not become ready, its
  application is stopped while the database and the backup are kept, and the README
  shows how to return to the previous version.
- **Start:** `./filterest start` in a folder prepared with `./filterest docker setup`
  starts the Docker stack instead of beginning a native setup beside it, and
  `./filterest status` shows its containers.
- **Private folders:** a folder whose files were created readable only by their owner
  could not start in Docker. The Docker command now makes the folders the database reads
  readable to it, and the application image makes its own copy of the program readable
  by its user and writable by no one.
- **Backups keep access rights:** before an update changes anything, the database
  backup now keeps who may read what. A site restored from a native installation's
  backup kept the data but lost what the limited database accounts for visitors, guests
  and read-only tools are allowed to read.

## Database 9.9.1

The update moves the database from 9.9.0 to 9.9.1. It adds the texts of the dataset
form's "Connect two fields" section and of its folder, rights, picture,
deletion-protection and link controls in Finnish, English, Chinese and Cantonese. A
translation a site has already changed is never overwritten. The section now explains
that the link runs from a column of this dataset to a column of the other, which is also
known as a foreign key, and its information symbol no longer disappears.

The update also clears a stale display setting that sites installed from the public
package carried, which made the server write a warning on every read of the dataset
registry, and gives one internal database link the same name on every site.

## Also

- On a Glowy card, a one-line description is centred against its icon, and keyword chips
  take their own theme colour in both themes, so they are readable.
- The start log no longer classes some 240 ordinary lines as errors, so a real error
  stands out.
- The workline observatory finds a workline by its number and searches the way every
  dataset does.
